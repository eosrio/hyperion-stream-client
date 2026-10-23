use std::fmt;

pub const PROTOCOL: &str = "hyperion-stream.v1.json";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Window {
    pub records: usize,
    pub bytes: usize,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub stream_window: Window,
    pub connection_window: Window,
    pub max_streams: usize,
    pub request_timeout_ms: u64,
    pub lib_timeout_ms: u64,
    pub expected_chain_id: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            stream_window: Window {
                records: 1024,
                bytes: 2 * 1024 * 1024,
            },
            connection_window: Window {
                records: 4096,
                bytes: 8 * 1024 * 1024,
            },
            max_streams: 16,
            request_timeout_ms: 10_000,
            lib_timeout_ms: 60_000,
            expected_chain_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub stream_id: Option<u64>,
}

impl Failure {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            stream_id: None,
        }
    }
    pub fn for_stream(mut self, stream_id: u64) -> Self {
        self.stream_id = Some(stream_id);
        self
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Failure {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hello {
    pub version: u16,
    pub chain_id: String,
    pub connection_id: u64,
    pub heartbeat_interval_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scope {
    pub connection_id: u64,
    pub stream_id: u64,
    pub generation: u64,
    pub subscription_id: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    Head,
    Irreversible,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    History,
    Live,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Record<T> {
    pub block_num: u32,
    pub block_id: String,
    pub cursor: Option<u64>,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Batch<T> {
    pub scope: Scope,
    pub sequence: u64,
    pub mode: Mode,
    pub records: Vec<Record<T>>,
    /// Measured by the codec from the complete UTF-8 data message, never trusted from the peer.
    pub wire_bytes: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lib {
    pub connection_id: u64,
    pub chain_id: String,
    pub block_num: u32,
    pub block_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fork {
    pub connection_id: u64,
    pub chain_id: String,
    pub starting_block: u32,
    pub ending_block: u32,
    pub new_block_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Input<T> {
    Hello(Hello),
    Accepted {
        scope: Scope,
        request_id: u64,
        start_from: u32,
    },
    Data(Batch<T>),
    HistoryEnd(Scope),
    End(Scope),
    Cancelled(Scope),
    Error {
        connection_id: u64,
        stream_id: Option<u64>,
        generation: Option<u64>,
        request_id: Option<u64>,
        failure: Failure,
    },
    Lib(Lib),
    Fork(Fork),
    Ping(u64),
    Pong(u64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command<R> {
    Ready {
        connection_id: u64,
        window: Window,
    },
    Subscribe {
        connection_id: u64,
        request_id: u64,
        stream_id: u64,
        generation: u64,
        request: R,
        resume_from: Option<u32>,
        window: Window,
    },
    Ack {
        scope: Scope,
        sequence: u64,
    },
    Cancel {
        connection_id: u64,
        request_id: u64,
        stream_id: u64,
        generation: u64,
        subscription_id: Option<u64>,
    },
    Pong(u64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Event<T> {
    Connected(Hello),
    Accepted { scope: Scope, start_from: u32 },
    Data(Batch<T>),
    HistoryEnd { stream_id: u64 },
    End { stream_id: u64 },
    Cancelled { stream_id: u64 },
    Error(Failure),
    Lib(Lib),
    Fork(Fork),
    Disconnected,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Transition<R, T> {
    pub commands: Vec<Command<R>>,
    pub events: Vec<Event<T>>,
}

impl<R, T> Default for Transition<R, T> {
    fn default() -> Self {
        Self {
            commands: Vec::new(),
            events: Vec::new(),
        }
    }
}
