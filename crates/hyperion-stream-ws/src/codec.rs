//! JSON is isolated here: the core's public API has no Serde or JSON types.
use hyperion_stream_core::*;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug)]
struct Decimal(u64);

impl<'de> Deserialize<'de> for Decimal {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        parse_decimal(&s)
            .map(Self)
            .ok_or_else(|| serde::de::Error::custom("Expected canonical uint64 decimal string"))
    }
}

pub fn parse_decimal(s: &str) -> Option<u64> {
    if s.is_empty() || (s.len() > 1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    s.parse().ok()
}

#[derive(Deserialize)]
struct WireScope {
    connection_id: Decimal,
    stream_id: Decimal,
    generation: Decimal,
    subscription_id: Decimal,
}

impl WireScope {
    fn into_scope(self) -> Result<Scope, Failure> {
        if [
            self.connection_id.0,
            self.stream_id.0,
            self.generation.0,
            self.subscription_id.0,
        ]
        .contains(&0)
        {
            return Err(invalid("Scope identifiers must be nonzero"));
        }
        Ok(Scope {
            connection_id: self.connection_id.0,
            stream_id: self.stream_id.0,
            generation: self.generation.0,
            subscription_id: self.subscription_id.0,
        })
    }
}

#[derive(Deserialize)]
struct WireRecord {
    block_num: u32,
    block_id: String,
    #[serde(default)]
    cursor: Option<Decimal>,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Packet {
    Hello {
        version: u16,
        chain_id: String,
        connection_id: Decimal,
        heartbeat_interval_ms: u64,
    },
    Accepted {
        #[serde(flatten)]
        scope: WireScope,
        request_id: Decimal,
        start_from: u32,
    },
    Data {
        #[serde(flatten)]
        scope: WireScope,
        sequence: Decimal,
        mode: String,
        records: Vec<WireRecord>,
    },
    HistoryEnd {
        #[serde(flatten)]
        scope: WireScope,
    },
    End {
        #[serde(flatten)]
        scope: WireScope,
    },
    Cancelled {
        #[serde(flatten)]
        scope: WireScope,
    },
    Error {
        connection_id: Decimal,
        stream_id: Option<Decimal>,
        generation: Option<Decimal>,
        request_id: Option<Decimal>,
        code: String,
        message: String,
        retryable: bool,
    },
    Lib {
        connection_id: Decimal,
        chain_id: String,
        block_num: u32,
        block_id: String,
    },
    Fork {
        connection_id: Decimal,
        chain_id: String,
        starting_block: u32,
        ending_block: u32,
        new_block_id: String,
    },
    Ping {
        id: Decimal,
    },
    Pong {
        id: Decimal,
    },
}

fn invalid(message: impl Into<String>) -> Failure {
    Failure::new("PROTOCOL_ERROR", message, false)
}

fn exact_metadata(value: &Value) -> Result<(), Failure> {
    let Some(object) = value.as_object() else {
        return Err(invalid("Record payload must be an object"));
    };
    for key in ["global_sequence", "recv_sequence", "sequence"] {
        if let Some(v) = object.get(key) {
            if !v.as_str().is_some_and(|s| parse_decimal(s).is_some()) {
                return Err(invalid(format!("{key} must be an exact decimal string")));
            }
        }
    }
    for key in ["receipt", "receipts", "auth_sequence"] {
        if let Some(v) = object.get(key) {
            if let Some(values) = v.as_array() {
                // ABI variant receipts may be [type, object]. Leave their tag intact.
                for child in values {
                    if child.is_object() {
                        exact_metadata(child)?;
                    }
                }
            } else if v.is_object() {
                exact_metadata(v)?;
            }
        }
    }
    Ok(())
}

/// Decode exactly one server text message. The caller bounds text before parsing.
/// Unknown fields are reserved extensions; unknown packet types fail closed.
pub fn decode(text: &str) -> Result<Input<Value>, Failure> {
    let packet: Packet =
        serde_json::from_str(text).map_err(|e| invalid(format!("Invalid JSON packet: {e}")))?;
    Ok(match packet {
        Packet::Hello {
            version,
            chain_id,
            connection_id,
            heartbeat_interval_ms,
        } => Input::Hello(Hello {
            version,
            chain_id,
            connection_id: connection_id.0,
            heartbeat_interval_ms,
        }),
        Packet::Accepted {
            scope,
            request_id,
            start_from,
        } => Input::Accepted {
            scope: scope.into_scope()?,
            request_id: request_id.0,
            start_from,
        },
        Packet::Data {
            scope,
            sequence,
            mode,
            records,
        } => {
            let mode = match mode.as_str() {
                "history" => Mode::History,
                "live" => Mode::Live,
                _ => return Err(invalid("Unknown data mode")),
            };
            let mut output = Vec::with_capacity(records.len());
            for record in records {
                if record.block_num == 0 || !is_hash(&record.block_id) {
                    return Err(invalid("Invalid record block identity"));
                }
                exact_metadata(&record.payload)?;
                output.push(Record {
                    block_num: record.block_num,
                    block_id: record.block_id,
                    cursor: record.cursor.map(|d| d.0),
                    payload: record.payload,
                });
            }
            if sequence.0 == 0 || output.is_empty() {
                return Err(invalid(
                    "Data needs a positive sequence and nonempty records",
                ));
            }
            Input::Data(Batch {
                scope: scope.into_scope()?,
                sequence: sequence.0,
                mode,
                records: output,
                wire_bytes: text.len(),
            })
        }
        Packet::HistoryEnd { scope } => Input::HistoryEnd(scope.into_scope()?),
        Packet::End { scope } => Input::End(scope.into_scope()?),
        Packet::Cancelled { scope } => Input::Cancelled(scope.into_scope()?),
        Packet::Error {
            connection_id,
            stream_id,
            generation,
            request_id,
            code,
            message,
            retryable,
        } => {
            if stream_id.is_some() != generation.is_some()
                || code.is_empty()
                || code.len() > 128
                || message.len() > 4096
                || connection_id.0 == 0
                || stream_id.is_some_and(|d| d.0 == 0)
                || generation.is_some_and(|d| d.0 == 0)
            {
                return Err(invalid("Invalid error scope or description"));
            }
            Input::Error {
                connection_id: connection_id.0,
                stream_id: stream_id.map(|d| d.0),
                generation: generation.map(|d| d.0),
                request_id: request_id.map(|d| d.0),
                failure: Failure::new(code, message, retryable),
            }
        }
        Packet::Lib {
            connection_id,
            chain_id,
            block_num,
            block_id,
        } => Input::Lib(Lib {
            connection_id: connection_id.0,
            chain_id,
            block_num,
            block_id,
        }),
        Packet::Fork {
            connection_id,
            chain_id,
            starting_block,
            ending_block,
            new_block_id,
        } => Input::Fork(Fork {
            connection_id: connection_id.0,
            chain_id,
            starting_block,
            ending_block,
            new_block_id,
        }),
        Packet::Ping { id } => Input::Ping(id.0),
        Packet::Pong { id } => Input::Pong(id.0),
    })
}

pub fn scope_json(s: &Scope) -> Value {
    json!({"connection_id":s.connection_id.to_string(),"stream_id":s.stream_id.to_string(),"generation":s.generation.to_string(),"subscription_id":s.subscription_id.to_string()})
}

pub fn command_json<R: Serialize>(command: &Command<R>) -> Result<Value, Failure> {
    let window = |w: &Window| json!({"records":w.records,"bytes":w.bytes});
    let value = match command {
        Command::Ready {
            connection_id,
            window: w,
        } => json!({"type":"ready","connection_id":connection_id.to_string(),"window":window(w)}),
        Command::Subscribe {
            connection_id,
            request_id,
            stream_id,
            generation,
            request,
            resume_from,
            window: w,
        } => {
            let request = serde_json::to_value(request).map_err(|e| invalid(e.to_string()))?;
            json!({"type":"subscribe","connection_id":connection_id.to_string(),"request_id":request_id.to_string(),"stream_id":stream_id.to_string(),"generation":generation.to_string(),"request":request,"resume_from":resume_from,"window":window(w)})
        }
        Command::Ack { scope, sequence } => {
            let mut v = scope_json(scope);
            v["type"] = json!("ack");
            v["sequence"] = json!(sequence.to_string());
            v
        }
        Command::Cancel {
            connection_id,
            request_id,
            stream_id,
            generation,
            subscription_id,
        } => {
            json!({"type":"cancel","connection_id":connection_id.to_string(),"request_id":request_id.to_string(),"stream_id":stream_id.to_string(),"generation":generation.to_string(),"subscription_id":subscription_id.map(|d| d.to_string())})
        }
        Command::Pong(id) => json!({"type":"pong","id":id.to_string()}),
    };
    Ok(value)
}

pub fn encode<R: Serialize>(command: &Command<R>) -> Result<String, Failure> {
    serde_json::to_string(&command_json(command)?).map_err(|e| invalid(e.to_string()))
}
