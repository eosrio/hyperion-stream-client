mod support;
use hyperion_stream_ws::{Options, WsClient};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde_json::json;
use std::sync::Arc;
use support::*;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::accept_hdr_async;

async fn connect_fixture(
    trusted: bool,
    correct_name: bool,
) -> Result<(), hyperion_stream_core::Failure> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server_config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![CertificateDer::from(
            include_bytes!("certs/server.der").to_vec(),
        )],
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            include_bytes!("certs/server-key.der").to_vec(),
        )),
    )
    .unwrap();
    let server = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let Ok(tls) = TlsAcceptor::from(Arc::new(server_config)).accept(tcp).await else {
            return;
        };
        let Ok(mut ws) = accept_hdr_async(tls, negotiate).await else {
            return;
        };
        send(&mut ws,json!({"type":"hello","version":1,"chain_id":"a".repeat(64),"connection_id":"1","heartbeat_interval_ms":15000})).await;
        assert_eq!(read(&mut ws).await["type"], "ready");
    });
    let mut options = Options::default();
    if trusted {
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(CertificateDer::from(
                include_bytes!("certs/ca.der").to_vec(),
            ))
            .unwrap();
        options.tls = Some(Arc::new(
            rustls::ClientConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth(),
        ));
    }
    let host = if correct_name {
        "localhost"
    } else {
        "127.0.0.1"
    };
    let result = WsClient::connect(
        &format!("wss://{host}:{}/stream/v2", address.port()),
        options,
    )
    .await;
    let outcome = result.map(drop);
    server.await.unwrap();
    outcome
}

#[tokio::test]
async fn wss_accepts_an_explicitly_trusted_matching_certificate() {
    connect_fixture(true, true).await.unwrap();
}
#[tokio::test]
async fn wss_rejects_an_untrusted_certificate() {
    assert!(!connect_fixture(false, true).await.unwrap_err().retryable);
}
#[tokio::test]
async fn wss_rejects_a_trusted_certificate_for_the_wrong_hostname() {
    assert!(!connect_fixture(true, false).await.unwrap_err().retryable);
}
