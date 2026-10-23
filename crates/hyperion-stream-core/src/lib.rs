//! Pure subscription state machine. No networking, serialization, clock or runtime dependencies.
#![doc = include_str!("../README.md")]

mod types;
use std::collections::{BTreeMap, VecDeque};

#[derive(Default, Clone, Copy)]
struct Usage {
    records: usize,
    bytes: usize,
}

impl Usage {
    fn release(&mut self, other: Self) {
        self.records -= other.records;
        self.bytes -= other.bytes;
    }
}
pub use types::*;

struct Subscription<R, T> {
    request: R,
    delivery: Delivery,
    replay: bool,
    generation: u64,
    scope: Option<Scope>,
    started_ms: Option<u64>,
    resume_from: Option<u32>,
    anchor: Option<u32>,
    queue: VecDeque<Batch<T>>,
    used: Usage,
    sequence: u64,
    last_block: Option<u32>,
    history_end: bool,
    ended: bool,
    lib_progress_ms: u64,
}

/// Single-owner deterministic state machine. Call `advance` with monotonic time,
/// feed decoded inputs, execute returned commands, and call `poll` for delivery.
pub struct Client<R, T> {
    config: Config,
    hello: Option<Hello>,
    chain_id: Option<String>,
    next_generation: u64,
    streams: BTreeMap<u64, Subscription<R, T>>,
    used: Usage,
    now_ms: u64,
    lib: Option<Lib>,
    // Consistency survives reconnect; eligibility to release data does not.
    highest_lib: Option<Lib>,
}

fn protocol(message: &str) -> Failure {
    Failure::new("PROTOCOL_ERROR", message, false)
}

pub fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl<R: Clone, T> Client<R, T> {
    pub fn new(config: Config) -> Result<Self, Failure> {
        for w in [&config.stream_window, &config.connection_window] {
            if w.records == 0
                || w.bytes == 0
                || w.records > 1_000_000
                || w.bytes > 1024 * 1024 * 1024
            {
                return Err(Failure::new(
                    "INVALID_CONFIG",
                    "Window outside supported bounds",
                    false,
                ));
            }
        }
        if config.max_streams == 0
            || config.max_streams > 1024
            || config.request_timeout_ms == 0
            || config.lib_timeout_ms == 0
            || config
                .expected_chain_id
                .as_ref()
                .is_some_and(|s| !is_hash(s))
        {
            return Err(Failure::new(
                "INVALID_CONFIG",
                "Invalid stream count, deadline or chain ID",
                false,
            ));
        }
        Ok(Self {
            chain_id: config.expected_chain_id.clone(),
            config,
            hello: None,
            next_generation: 1,
            streams: BTreeMap::new(),
            used: Usage::default(),
            now_ms: 0,
            lib: None,
            highest_lib: None,
        })
    }

    pub fn config(&self) -> &Config {
        &self.config
    }
    pub fn is_connected(&self) -> bool {
        self.hello.is_some()
    }
    pub fn stream_count(&self) -> usize {
        self.streams.len()
    }

    pub fn subscribe(
        &mut self,
        stream_id: u64,
        request: R,
        delivery: Delivery,
        replay: bool,
    ) -> Result<Transition<R, T>, Failure> {
        if stream_id == 0 || self.streams.contains_key(&stream_id) {
            return Err(Failure::new(
                "INVALID_REQUEST",
                "Stream ID must be nonzero and unused",
                false,
            ));
        }
        if self.streams.len() >= self.config.max_streams {
            return Err(Failure::new(
                "STREAM_LIMIT",
                "Maximum subscription count reached",
                false,
            ));
        }
        let generation = self.allocate_generation()?;
        self.streams.insert(
            stream_id,
            Subscription {
                request,
                delivery,
                replay,
                generation,
                scope: None,
                started_ms: self.hello.as_ref().map(|_| self.now_ms),
                resume_from: None,
                anchor: None,
                queue: VecDeque::new(),
                used: Usage::default(),
                sequence: 0,
                last_block: None,
                history_end: false,
                ended: false,
                lib_progress_ms: self.now_ms,
            },
        );
        let mut result = Transition::default();
        if let Some(h) = &self.hello {
            result
                .commands
                .push(self.subscribe_command(stream_id, h.connection_id));
        }
        Ok(result)
    }

    fn allocate_generation(&mut self) -> Result<u64, Failure> {
        let result = self.next_generation;
        self.next_generation = result
            .checked_add(1)
            .ok_or_else(|| Failure::new("ID_EXHAUSTED", "Generation counter exhausted", false))?;
        Ok(result)
    }

    fn subscribe_command(&self, stream_id: u64, connection_id: u64) -> Command<R> {
        let s = &self.streams[&stream_id];
        Command::Subscribe {
            connection_id,
            request_id: s.generation,
            stream_id,
            generation: s.generation,
            request: s.request.clone(),
            resume_from: s.resume_from,
            window: self.config.stream_window.clone(),
        }
    }

    fn current(&self, scope: &Scope) -> bool {
        self.hello
            .as_ref()
            .is_some_and(|h| h.connection_id == scope.connection_id)
            && self
                .streams
                .get(&scope.stream_id)
                .is_some_and(|s| s.scope.as_ref() == Some(scope))
    }

    fn connection_is_current(&self, connection_id: u64) -> bool {
        self.hello
            .as_ref()
            .is_some_and(|h| h.connection_id == connection_id)
    }

    fn cancel_command(stream_id: u64, s: &Subscription<R, T>, connection_id: u64) -> Command<R> {
        Command::Cancel {
            connection_id,
            request_id: s.generation,
            stream_id,
            generation: s.generation,
            subscription_id: s.scope.as_ref().map(|s| s.subscription_id),
        }
    }

    fn fail_stream(&mut self, stream_id: u64, failure: Failure) -> Transition<R, T> {
        let mut result = Transition::default();
        if let Some(s) = self.remove_stream(stream_id) {
            if let Some(h) = &self.hello {
                result
                    .commands
                    .push(Self::cancel_command(stream_id, &s, h.connection_id));
            }
            result
                .events
                .push(Event::Error(failure.for_stream(stream_id)));
        }
        result
    }

    fn remove_stream(&mut self, stream_id: u64) -> Option<Subscription<R, T>> {
        let stream = self.streams.remove(&stream_id)?;
        self.used.release(stream.used);
        Some(stream)
    }

    pub fn receive(&mut self, input: Input<T>) -> Result<Transition<R, T>, Failure> {
        let mut result = Transition::default();
        match input {
            Input::Hello(h) => {
                if self.hello.is_some()
                    || h.version != 1
                    || h.connection_id == 0
                    || !is_hash(&h.chain_id)
                    || h.heartbeat_interval_ms == 0
                    || h.heartbeat_interval_ms > 60_000
                {
                    return Err(protocol("Invalid or duplicate hello"));
                }
                if self.chain_id.as_ref().is_some_and(|id| id != &h.chain_id) {
                    return Err(Failure::new(
                        "CHAIN_MISMATCH",
                        "Server chain identity changed",
                        false,
                    ));
                }
                self.chain_id = Some(h.chain_id.clone());
                result.commands.push(Command::Ready {
                    connection_id: h.connection_id,
                    window: self.config.connection_window.clone(),
                });
                for s in self.streams.values_mut() {
                    s.started_ms = Some(self.now_ms);
                }
                for &id in self.streams.keys() {
                    result
                        .commands
                        .push(self.subscribe_command(id, h.connection_id));
                }
                result.events.push(Event::Connected(h.clone()));
                self.hello = Some(h);
            }
            Input::Accepted {
                scope,
                request_id,
                start_from,
            } => {
                if !self.connection_is_current(scope.connection_id) {
                    return Ok(result);
                }
                let Some(s) = self.streams.get_mut(&scope.stream_id) else {
                    return Ok(result);
                };
                if s.generation != scope.generation {
                    return Ok(result);
                }
                if scope.subscription_id == 0
                    || start_from == 0
                    || request_id != s.generation
                    || s.scope.is_some()
                    || s.resume_from.is_some_and(|b| b != start_from)
                {
                    return Ok(self.fail_stream(
                        scope.stream_id,
                        protocol("Invalid acceptance or changed replay boundary"),
                    ));
                }
                s.anchor = Some(start_from);
                s.scope = Some(scope.clone());
                s.started_ms = None;
                result.events.push(Event::Accepted { scope, start_from });
            }
            Input::Data(batch) => {
                let id = batch.scope.stream_id;
                if self
                    .hello
                    .as_ref()
                    .is_some_and(|h| h.connection_id == batch.scope.connection_id)
                    && self.streams.get(&id).is_some_and(|s| {
                        s.generation == batch.scope.generation && s.scope.is_none()
                    })
                {
                    return Ok(self.fail_stream(id, protocol("Data arrived before acceptance")));
                }
                if !self.current(&batch.scope) {
                    return Ok(result);
                }
                let s = &self.streams[&id];
                let valid = !s.ended
                    && s.sequence.checked_add(1) == Some(batch.sequence)
                    && !batch.records.is_empty()
                    && batch.wire_bytes > 0
                    && (batch.mode == Mode::Live) == s.history_end
                    && batch
                        .records
                        .iter()
                        .all(|r| r.block_num > 0 && is_hash(&r.block_id))
                    && batch
                        .records
                        .windows(2)
                        .all(|w| w[0].block_num <= w[1].block_num)
                    && s.last_block.is_none_or(|b| b <= batch.records[0].block_num)
                    && s.anchor.is_none_or(|b| b <= batch.records[0].block_num)
                    && self.highest_lib.as_ref().is_none_or(|lib| {
                        batch
                            .records
                            .iter()
                            .all(|r| r.block_num != lib.block_num || r.block_id == lib.block_id)
                    });
                if !valid {
                    return Ok(self.fail_stream(
                        id,
                        protocol("Invalid data order, phase, records or sequence"),
                    ));
                }
                let fits = |used: usize, added: usize, limit: usize| {
                    used.checked_add(added).is_some_and(|sum| sum <= limit)
                };
                if !fits(
                    s.used.records,
                    batch.records.len(),
                    self.config.stream_window.records,
                ) || !fits(
                    s.used.bytes,
                    batch.wire_bytes,
                    self.config.stream_window.bytes,
                ) || !fits(
                    self.used.records,
                    batch.records.len(),
                    self.config.connection_window.records,
                ) || !fits(
                    self.used.bytes,
                    batch.wire_bytes,
                    self.config.connection_window.bytes,
                ) {
                    return Ok(self.fail_stream(
                        id,
                        Failure::new("SLOW_CONSUMER", "Peer exceeded acceptance window", true),
                    ));
                }
                let s = self.streams.get_mut(&id).expect("current scope");
                if s.queue.is_empty() {
                    s.lib_progress_ms = self.now_ms;
                }
                s.sequence = batch.sequence;
                s.last_block = batch.records.last().map(|r| r.block_num);
                s.used.records += batch.records.len();
                s.used.bytes += batch.wire_bytes;
                self.used.records += batch.records.len();
                self.used.bytes += batch.wire_bytes;
                s.queue.push_back(batch);
            }
            Input::HistoryEnd(scope) => {
                if self.current(&scope) {
                    let s = self
                        .streams
                        .get_mut(&scope.stream_id)
                        .expect("current scope");
                    if s.history_end || s.ended {
                        return Ok(self.fail_stream(
                            scope.stream_id,
                            protocol("Duplicate or late history_end"),
                        ));
                    }
                    s.history_end = true;
                    result.events.push(Event::HistoryEnd {
                        stream_id: scope.stream_id,
                    });
                }
            }
            Input::End(scope) => {
                if self.current(&scope) {
                    let s = self
                        .streams
                        .get_mut(&scope.stream_id)
                        .expect("current scope");
                    if !s.history_end || s.ended {
                        return Ok(self.fail_stream(scope.stream_id, protocol("Invalid end")));
                    }
                    s.ended = true;
                }
            }
            Input::Ping(id) => {
                result.commands.push(Command::Pong(id));
            }
            Input::Pong(_) | Input::Cancelled(_) => {}
            Input::Lib(lib) => {
                if !self.connection_is_current(lib.connection_id) {
                    return Ok(result);
                }
                if self.chain_id.as_ref() != Some(&lib.chain_id)
                    || lib.block_num == 0
                    || !is_hash(&lib.block_id)
                {
                    return Err(protocol("Invalid LIB identity"));
                }
                if let Some(previous) = &self.highest_lib {
                    if lib.block_num < previous.block_num
                        || (lib.block_num == previous.block_num
                            && lib.block_id != previous.block_id)
                    {
                        return Err(protocol("LIB regressed or changed identity"));
                    }
                    if lib.block_num == previous.block_num && self.lib.is_some() {
                        return Ok(result);
                    }
                }
                if self
                    .streams
                    .values()
                    .flat_map(|s| &s.queue)
                    .flat_map(|b| &b.records)
                    .any(|r| r.block_num == lib.block_num && r.block_id != lib.block_id)
                {
                    return Err(protocol("LIB contradicts buffered block identity"));
                }
                for s in self.streams.values_mut() {
                    s.lib_progress_ms = self.now_ms;
                }
                self.lib = Some(lib.clone());
                self.highest_lib = Some(lib.clone());
                result.events.push(Event::Lib(lib));
            }
            Input::Fork(fork) => {
                if !self.connection_is_current(fork.connection_id) {
                    return Ok(result);
                }
                if self.chain_id.as_ref() != Some(&fork.chain_id)
                    || fork.starting_block == 0
                    || fork.starting_block > fork.ending_block
                    || !is_hash(&fork.new_block_id)
                    || self
                        .highest_lib
                        .as_ref()
                        .is_some_and(|lib| fork.starting_block <= lib.block_num)
                {
                    return Err(protocol("Invalid fork identity or irreversible fork"));
                }
                result.events.push(Event::Fork(fork.clone()));
                let ids: Vec<_> = self.streams.keys().copied().collect();
                for id in ids {
                    if !self.streams[&id].replay {
                        let failure = self.fail_stream(
                            id,
                            Failure::new(
                                "STREAM_REPLAY_REQUIRED",
                                "Fork requires inclusive replay",
                                true,
                            ),
                        );
                        result.commands.extend(failure.commands);
                        result.events.extend(failure.events);
                        continue;
                    }
                    let resume = Self::replay_boundary(&self.streams[&id])
                        .unwrap_or(fork.starting_block)
                        .min(fork.starting_block);
                    result.commands.push(Self::cancel_command(
                        id,
                        &self.streams[&id],
                        fork.connection_id,
                    ));
                    let generation = self.allocate_generation()?;
                    let mut s = self.remove_stream(id).expect("saved stream");
                    Self::reset_attempt(&mut s, generation, Some(resume), self.now_ms);
                    s.started_ms = Some(self.now_ms);
                    self.streams.insert(id, s);
                    result
                        .commands
                        .push(self.subscribe_command(id, fork.connection_id));
                }
            }
            Input::Error {
                connection_id,
                stream_id,
                generation,
                request_id,
                failure,
            } => {
                if !self.connection_is_current(connection_id) {
                    return Ok(result);
                }
                if stream_id.is_some() != generation.is_some() {
                    return Err(protocol("Incomplete error scope"));
                }
                if let Some(id) = stream_id {
                    if self
                        .streams
                        .get(&id)
                        .is_some_and(|s| Some(s.generation) == generation)
                    {
                        if request_id.is_some_and(|r| Some(r) != generation) {
                            return Ok(self
                                .fail_stream(id, protocol("Error request correlation mismatch")));
                        }
                        return Ok(self.fail_stream(id, failure));
                    }
                } else {
                    return Err(failure);
                }
            }
        }
        Ok(result)
    }

    fn replay_boundary(s: &Subscription<R, T>) -> Option<u32> {
        [
            s.resume_from,
            s.anchor,
            s.queue
                .front()
                .and_then(|b| b.records.first().map(|r| r.block_num)),
        ]
        .into_iter()
        .flatten()
        .min()
    }

    fn reset_attempt(
        s: &mut Subscription<R, T>,
        generation: u64,
        resume_from: Option<u32>,
        now_ms: u64,
    ) {
        s.generation = generation;
        s.resume_from = resume_from;
        s.scope = None;
        s.started_ms = None;
        s.queue.clear();
        s.used = Usage::default();
        s.sequence = 0;
        s.last_block = None;
        s.history_end = false;
        s.ended = false;
        s.lib_progress_ms = now_ms;
    }

    /// Invalidates all transport-owned scopes and unconfirmed payloads. Repeated
    /// disconnects preserve the earliest recovery point until new data is handed
    /// to the caller. No acknowledgement from a later connection can release an
    /// earlier connection's buffered data.
    pub fn disconnect(&mut self) -> Result<Transition<R, T>, Failure> {
        let mut result = Transition::default();
        if self.hello.take().is_none() {
            return Ok(result);
        }
        self.lib = None;
        result.events.push(Event::Disconnected);
        let ids: Vec<_> = self.streams.keys().copied().collect();
        for id in ids {
            if !self.streams[&id].replay {
                self.remove_stream(id);
                result.events.push(Event::Error(
                    Failure::new(
                        "STREAM_REPLAY_REQUIRED",
                        "Transport loss requires inclusive replay",
                        true,
                    )
                    .for_stream(id),
                ));
                continue;
            }
            let resume = Self::replay_boundary(&self.streams[&id]);
            let generation = self.allocate_generation()?;
            let mut s = self.remove_stream(id).expect("saved stream");
            Self::reset_attempt(&mut s, generation, resume, self.now_ms);
            self.streams.insert(id, s);
        }
        Ok(result)
    }

    /// Stops local delivery immediately. A returned Cancel command still needs
    /// bounded transport I/O; this event is not proof of server cleanup.
    pub fn cancel(&mut self, stream_id: u64) -> Transition<R, T> {
        let mut result = Transition::default();
        if let Some(s) = self.remove_stream(stream_id) {
            if let Some(h) = &self.hello {
                result
                    .commands
                    .push(Self::cancel_command(stream_id, &s, h.connection_id));
            }
            result.events.push(Event::Cancelled { stream_id });
        }
        result
    }

    /// Supply monotonic milliseconds from the adapter. No wall-clock or runtime
    /// is part of the core. Equal LIB updates and heartbeats do not reset progress.
    pub fn advance(&mut self, now_ms: u64) -> Result<Transition<R, T>, Failure> {
        if now_ms < self.now_ms {
            return Err(Failure::new("INVALID_CLOCK", "Time moved backwards", false));
        }
        self.now_ms = now_ms;
        let expired: Vec<_> = self
            .streams
            .iter()
            .filter_map(|(&id, s)| {
                if s.started_ms.is_some_and(|start| {
                    now_ms.saturating_sub(start) >= self.config.request_timeout_ms
                }) {
                    return Some((
                        id,
                        Failure::new(
                            "REQUEST_TIMEOUT",
                            "Subscription acceptance deadline elapsed",
                            true,
                        ),
                    ));
                }
                if s.delivery == Delivery::Irreversible
                    && s.queue.front().is_some_and(|b| {
                        self.lib.as_ref().is_none_or(|lib| {
                            b.records
                                .last()
                                .is_some_and(|r| r.block_num > lib.block_num)
                        })
                    })
                    && now_ms.saturating_sub(s.lib_progress_ms) >= self.config.lib_timeout_ms
                {
                    return Some((
                        id,
                        Failure::new(
                            "LIB_TIMEOUT",
                            "Irreversible progress deadline elapsed",
                            true,
                        ),
                    ));
                }
                None
            })
            .collect();
        let mut result = Transition::default();
        for (id, failure) in expired {
            let failure = self.fail_stream(id, failure);
            result.commands.extend(failure.commands);
            result.events.extend(failure.events);
        }
        Ok(result)
    }

    /// Hands one ready batch to the application and releases exactly its credit.
    /// Event::End follows the last batch; stalled irreversible streams do not
    /// block delivery for other subscriptions.
    pub fn poll(&mut self) -> Transition<R, T> {
        let mut result = Transition::default();
        let id = self.streams.iter().find_map(|(&id, s)| {
            let ready = s.queue.front().is_some_and(|b| {
                s.delivery == Delivery::Head
                    || self.lib.as_ref().is_some_and(|lib| {
                        b.records
                            .last()
                            .is_some_and(|r| r.block_num <= lib.block_num)
                    })
            });
            (ready || (s.ended && s.queue.is_empty())).then_some(id)
        });
        if let Some(id) = id {
            let s = self.streams.get_mut(&id).expect("selected stream");
            if let Some(batch) = s.queue.pop_front() {
                let cost = Usage {
                    records: batch.records.len(),
                    bytes: batch.wire_bytes,
                };
                s.used.release(cost);
                self.used.release(cost);
                s.anchor = batch.records.last().map(|r| r.block_num);
                s.resume_from = None;
                result.commands.push(Command::Ack {
                    scope: batch.scope.clone(),
                    sequence: batch.sequence,
                });
                result.events.push(Event::Data(batch));
            } else {
                self.remove_stream(id);
                result.events.push(Event::End { stream_id: id });
            }
        }
        result
    }
}
