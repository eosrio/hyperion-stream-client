use crate::{codec, Request};
use futures_util::{SinkExt, StreamExt};
use hyperion_stream_core::{
    Client, Command, Config, Delivery, Event, Failure, Hello, Input, Transition, PROTOCOL,
};
use serde_json::Value;
use std::{collections::VecDeque, sync::Arc, time::Duration};
use tokio::{
    net::TcpStream,
    time::{timeout, Instant},
};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{
        client::IntoClientRequest,
        http::{HeaderMap, HeaderValue},
        protocol::WebSocketConfig,
        Message,
    },
    Connector, MaybeTlsStream, WebSocketStream,
};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Networking dependencies are explicit and confined to this adapter. `tls`
/// permits caller-supplied CA roots/client certificates; the default uses Mozilla
/// roots and an explicitly selected Ring provider, with certificate verification.
#[derive(Clone)]
pub struct Options {
    pub core: Config,
    pub max_message_bytes: usize,
    pub connect_timeout: Duration,
    pub write_timeout: Duration,
    pub idle_timeout: Duration,
    pub max_pending_events: usize,
    pub headers: HeaderMap,
    pub tls: Option<Arc<rustls::ClientConfig>>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            core: Config::default(),
            max_message_bytes: 1024 * 1024,
            connect_timeout: Duration::from_secs(5),
            write_timeout: Duration::from_secs(5),
            idle_timeout: Duration::from_secs(45),
            max_pending_events: 64,
            headers: HeaderMap::new(),
            tls: None,
        }
    }
}

fn transport_error(error: impl std::fmt::Display) -> Failure {
    Failure::new("TRANSPORT_ERROR", error.to_string(), true)
}

fn socket_failure(error: tokio_tungstenite::tungstenite::Error) -> Failure {
    use tokio_tungstenite::tungstenite::{error::ProtocolError, Error};
    let (code, retryable) = match &error {
        Error::Http(response) => (
            "HTTP_ERROR",
            response.status().is_server_error() || matches!(response.status().as_u16(), 408 | 429),
        ),
        Error::Tls(_) => ("TLS_ERROR", false),
        Error::Io(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            ("TLS_OR_PROTOCOL_ERROR", false)
        }
        Error::Capacity(_) => ("MESSAGE_TOO_LARGE", false),
        Error::Protocol(ProtocolError::ResetWithoutClosingHandshake) => ("TRANSPORT_ERROR", true),
        Error::Protocol(_) | Error::Utf8(_) | Error::AttackAttempt => ("PROTOCOL_ERROR", false),
        Error::Url(_) | Error::HttpFormat(_) => ("INVALID_ENDPOINT", false),
        _ => ("TRANSPORT_ERROR", true),
    };
    Failure::new(code, error.to_string(), retryable)
}

fn default_tls() -> Result<Arc<rustls::ClientConfig>, Failure> {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(transport_error)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(Arc::new(config))
}

async fn open(endpoint: &str, options: &Options) -> Result<(Socket, Hello), Failure> {
    timeout(options.connect_timeout, async {
        let mut request = endpoint.into_client_request().map_err(socket_failure)?;
        for (key, value) in &options.headers {
            request.headers_mut().insert(key, value.clone());
        }
        request
            .headers_mut()
            .insert("sec-websocket-protocol", HeaderValue::from_static(PROTOCOL));
        let config = WebSocketConfig::default()
            .max_message_size(Some(options.max_message_bytes))
            .max_frame_size(Some(options.max_message_bytes))
            .write_buffer_size(0)
            .max_write_buffer_size(options.max_message_bytes + 1024);
        let tls = match &options.tls {
            Some(tls) => tls.clone(),
            None => default_tls()?,
        };
        let (mut socket, response) = connect_async_tls_with_config(
            request,
            Some(config),
            false,
            Some(Connector::Rustls(tls)),
        )
        .await
        .map_err(socket_failure)?;
        if response
            .headers()
            .get("sec-websocket-protocol")
            .and_then(|h| h.to_str().ok())
            != Some(PROTOCOL)
        {
            return Err(Failure::new(
                "PROTOCOL_ERROR",
                "Server did not select the required subprotocol",
                false,
            ));
        }
        let message = socket
            .next()
            .await
            .ok_or_else(|| transport_error("Closed before hello"))?
            .map_err(socket_failure)?;
        let Message::Text(text) = message else {
            return Err(Failure::new(
                "PROTOCOL_ERROR",
                "First message must be JSON hello",
                false,
            ));
        };
        let Input::Hello(hello) = codec::decode(&text)? else {
            return Err(Failure::new(
                "PROTOCOL_ERROR",
                "First message must be hello",
                false,
            ));
        };
        Ok((socket, hello))
    })
    .await
    .map_err(|_| Failure::new("CONNECT_TIMEOUT", "Connection/hello deadline elapsed", true))?
}

/// Single-owner, pull-driven native client. `next_event` drives reads, liveness
/// and deadlines; no detached tasks outlive the client. Long application work
/// should keep polling in an application-owned task with a bounded channel.
pub struct WsClient {
    endpoint: String,
    options: Options,
    core: Client<Request, Value>,
    socket: Option<Socket>,
    pending: VecDeque<Event<Value>>,
    deferred: VecDeque<Command<Request>>,
    clock: Instant,
    last_received: Instant,
    last_ping: Instant,
    ping_id: u64,
    heartbeat: Duration,
    control_epoch: Instant,
    control_count: u32,
}

impl WsClient {
    pub async fn connect(endpoint: &str, options: Options) -> Result<Self, Failure> {
        let mut core = Client::new(options.core.clone())?;
        if !(128..=1024 * 1024).contains(&options.max_message_bytes)
            || options.connect_timeout.is_zero()
            || options.write_timeout.is_zero()
            || options.idle_timeout.is_zero()
            || options.max_pending_events < options.core.max_streams + 2
            || options.max_pending_events > 4096
        {
            return Err(Failure::new(
                "INVALID_CONFIG",
                "Invalid message cap or network deadline",
                false,
            ));
        }
        let (socket, hello) = open(endpoint, &options).await?;
        let heartbeat = Duration::from_millis(hello.heartbeat_interval_ms);
        let transition = core.receive(Input::Hello(hello))?;
        let now = Instant::now();
        let mut client = Self {
            endpoint: endpoint.into(),
            options,
            core,
            socket: Some(socket),
            pending: VecDeque::new(),
            deferred: VecDeque::new(),
            clock: now,
            last_received: now,
            last_ping: now,
            ping_id: 0,
            heartbeat,
            control_epoch: now,
            control_count: 0,
        };
        client.apply(transition).await?;
        Ok(client)
    }

    pub fn is_connected(&self) -> bool {
        self.socket.is_some() && self.core.is_connected()
    }

    fn detach(&mut self) -> Result<(), Failure> {
        self.socket = None;
        self.deferred.clear();
        // Preserve terminal outcomes even when replaced transport notifications
        // become obsolete. A fixed reserve holds disconnect outcomes once; an
        // additional detach cannot add them again because the core is offline.
        self.pending.retain(|e| matches!(e, Event::Error(_)));
        let transition = self.core.disconnect()?;
        self.pending.extend(transition.events);
        Ok(())
    }

    async fn broken(&mut self, error: Failure) -> Failure {
        if let Err(failure) = self.detach() {
            return failure;
        }
        error
    }

    async fn send_text(&mut self, text: String) -> Result<(), Failure> {
        if text.len() > self.options.max_message_bytes {
            return Err(Failure::new(
                "MESSAGE_TOO_LARGE",
                "Outbound message exceeds configured cap",
                false,
            ));
        }
        let socket = self
            .socket
            .as_mut()
            .ok_or_else(|| transport_error("Disconnected; call reconnect"))?;
        let sent = timeout(self.options.write_timeout, socket.send(Message::text(text))).await;
        let error = match sent {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(error)) => socket_failure(error),
            Err(_) => Failure::new("WRITE_TIMEOUT", "WebSocket write deadline elapsed", true),
        };
        Err(self.broken(error).await)
    }

    async fn flush_deferred(&mut self) -> Result<(), Failure> {
        while let Some(command) = self.deferred.front() {
            let text = codec::encode(command)?;
            self.send_text(text).await?;
            self.deferred.pop_front();
        }
        Ok(())
    }

    async fn apply(&mut self, transition: Transition<Request, Value>) -> Result<(), Failure> {
        if !transition.events.is_empty()
            && self.pending.len().saturating_add(transition.events.len())
                > self.options.max_pending_events
        {
            // Terminal errors already removed their streams in the core. Keep
            // those outcomes in the reserve; each reduces the remaining active
            // stream disconnect obligations one-for-one.
            self.pending.extend(
                transition
                    .events
                    .into_iter()
                    .filter(|e| matches!(e, Event::Error(_))),
            );
            return Err(self
                .broken(Failure::new(
                    "EVENT_QUEUE_OVERFLOW",
                    "Poll events before issuing more controls",
                    true,
                ))
                .await);
        }
        self.pending.extend(transition.events);
        self.deferred.extend(transition.commands);
        self.flush_deferred().await
    }

    async fn advance(&mut self) -> Result<(), Failure> {
        let elapsed = u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX);
        let transition = self.core.advance(elapsed)?;
        self.apply(transition).await
    }

    pub async fn subscribe(
        &mut self,
        stream_id: u64,
        request: Request,
        delivery: Delivery,
        replay_on_reconnect: bool,
    ) -> Result<(), Failure> {
        request.validate()?;
        let request_bytes = serde_json::to_vec(&request).map_err(transport_error)?.len();
        if request_bytes.saturating_add(512) > self.options.max_message_bytes {
            return Err(Failure::new(
                "MESSAGE_TOO_LARGE",
                "Subscription request exceeds configured cap",
                false,
            ));
        }
        self.advance().await?;
        // Admission must also be bounded while offline: an empty subscribe
        // transition can create a future terminal error obligation. Otherwise
        // repeated failed reconnects could reuse the disconnect reserve forever.
        if self.pending.len() >= self.options.max_pending_events {
            return Err(Failure::new(
                "EVENT_QUEUE_OVERFLOW",
                "Poll terminal outcomes before creating another subscription",
                true,
            ));
        }
        let transition = self
            .core
            .subscribe(stream_id, request, delivery, replay_on_reconnect)?;
        self.apply(transition).await
    }

    /// Stop local delivery first. Flush previously delivered batch acceptance
    /// before cancellation; remote cleanup is a separate server responsibility.
    pub async fn cancel(&mut self, stream_id: u64) -> Result<(), Failure> {
        let transition = self.core.cancel(stream_id);
        self.pending
            .retain(|e| !matches!(e, Event::Data(b) if b.scope.stream_id == stream_id));
        self.apply(transition).await
    }

    /// Explicit bounded reconnect, preserving the core's inclusive replay point.
    /// Authentication, source and protocol failures are never infinitely retried.
    pub async fn reconnect(&mut self) -> Result<(), Failure> {
        self.detach()?;
        self.pending.retain(|e| matches!(e, Event::Error(_)));
        let (socket, hello) = open(&self.endpoint, &self.options).await?;
        // Offline/handshake time is elapsed before a replacement attempt starts.
        // It must not consume that new attempt's acceptance deadline.
        let elapsed = u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX);
        let transition = self.core.advance(elapsed)?;
        self.pending.extend(transition.events);
        let transition = self.core.receive(Input::Hello(hello.clone()))?;
        self.socket = Some(socket);
        self.heartbeat = Duration::from_millis(hello.heartbeat_interval_ms);
        self.last_received = Instant::now();
        self.last_ping = self.last_received;
        self.control_epoch = self.last_received;
        self.control_count = 0;
        self.apply(transition).await
    }

    /// Delivers one public event. Batch credit is sent on the next drive call,
    /// after this batch has actually been returned, so an ACK write failure
    /// cannot discard a never-delivered batch while advancing the replay point.
    pub async fn next_event(&mut self) -> Result<Event<Value>, Failure> {
        self.flush_deferred().await?;
        loop {
            self.advance().await?;
            if let Some(event) = self.pending.pop_front() {
                return Ok(event);
            }
            let transition = self.core.poll();
            if !transition.events.is_empty() {
                self.deferred.extend(transition.commands);
                self.pending.extend(transition.events);
                return Ok(self.pending.pop_front().expect("nonempty transition"));
            }
            let tick_ms = self
                .options
                .core
                .request_timeout_ms
                .min(self.options.core.lib_timeout_ms)
                .min(self.heartbeat.as_millis() as u64)
                .clamp(2, 200)
                / 2;
            let socket = self
                .socket
                .as_mut()
                .ok_or_else(|| transport_error("Disconnected; call reconnect"))?;
            let received = tokio::select! {
                packet = socket.next() => Some(packet),
                _ = tokio::time::sleep(Duration::from_millis(tick_ms)) => None,
            };
            if let Some(packet) = received {
                let message = match packet {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => return Err(self.broken(socket_failure(error)).await),
                    None => return Err(self.broken(transport_error("WebSocket closed")).await),
                };
                self.last_received = Instant::now();
                match message {
                    Message::Text(text) => {
                        let input = match codec::decode(&text) {
                            Ok(input) => input,
                            Err(error) => return Err(self.broken(error).await),
                        };
                        if !matches!(&input, Input::Data(_)) {
                            if self.control_epoch.elapsed() >= Duration::from_secs(1) {
                                self.control_epoch = Instant::now();
                                self.control_count = 0;
                            }
                            self.control_count += 1;
                            if self.control_count > 1024 {
                                return Err(self
                                    .broken(Failure::new(
                                        "CONTROL_LIMIT",
                                        "Control message rate exceeded",
                                        false,
                                    ))
                                    .await);
                            }
                        }
                        let transition = match self.core.receive(input) {
                            Ok(transition) => transition,
                            Err(error) => return Err(self.broken(error).await),
                        };
                        self.apply(transition).await?;
                    }
                    Message::Ping(_) => {
                        let result = timeout(
                            self.options.write_timeout,
                            self.socket.as_mut().expect("connected").flush(),
                        )
                        .await;
                        if !matches!(result, Ok(Ok(()))) {
                            return Err(self
                                .broken(transport_error("WebSocket pong write failed"))
                                .await);
                        }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) => {
                        return Err(self.broken(transport_error("Peer closed WebSocket")).await)
                    }
                    Message::Binary(_) | Message::Frame(_) => {
                        return Err(self
                            .broken(Failure::new(
                                "PROTOCOL_ERROR",
                                "Only JSON text messages are supported",
                                false,
                            ))
                            .await)
                    }
                }
            }
            if self.last_received.elapsed() >= self.options.idle_timeout {
                return Err(self
                    .broken(Failure::new(
                        "IDLE_TIMEOUT",
                        "Peer liveness deadline elapsed",
                        true,
                    ))
                    .await);
            }
            if self.last_ping.elapsed() >= self.heartbeat {
                self.ping_id = self.ping_id.checked_add(1).ok_or_else(|| {
                    Failure::new("ID_EXHAUSTED", "Heartbeat counter exhausted", false)
                })?;
                self.send_text(
                    serde_json::json!({"type":"ping","id":self.ping_id.to_string()}).to_string(),
                )
                .await?;
                self.last_ping = Instant::now();
            }
        }
    }
}
