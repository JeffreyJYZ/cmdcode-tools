// The wallet reader: the daemon's shapes, a real stub over TCP, and the closed
// port every machine without the app running has.
use crate::oduse::wallet::{self, Unavailable};

#[test]
fn a_snapshot_parses_into_the_dashboard_figures() {
    let wallet = wallet::parse(
        r#"{"balanceUsd":12.34,"source":"vela","profile":"pro","user":"jyz","stale":false}"#,
    )
    .expect("parses");
    assert_eq!(wallet.balance_usd, 12.34);
    assert_eq!(wallet.source.as_deref(), Some("vela"));
    assert_eq!(wallet.profile.as_deref(), Some("pro"));
    assert_eq!(wallet.user.as_deref(), Some("jyz"));
    assert!(!wallet.stale);
    // An object user yields the email.
    let wallet =
        wallet::parse(r#"{"balanceUsd":0,"user":{"email":"a@b.c","name":"A"},"stale":true}"#)
            .expect("parses");
    assert_eq!(wallet.user.as_deref(), Some("a@b.c"));
    assert!(wallet.stale);
}

#[test]
fn a_refusal_keeps_the_daemons_own_words() {
    let why =
        wallet::parse(r#"{"error":{"kind":"unauthorized","message":"Vela control key expired"}}"#)
            .unwrap_err();
    assert_eq!(
        why.reason().as_deref(),
        Some("wallet: unauthorized (Vela control key expired)")
    );
    let why = wallet::parse(r#"{"error":{"kind":"upstream"}}"#).unwrap_err();
    assert_eq!(why.reason().as_deref(), Some("wallet: upstream"));
    // An answer with neither balance nor error is a fault, not a zero.
    assert!(matches!(
        wallet::parse(r#"{"stale":false}"#),
        Err(Unavailable::Transport(_))
    ));
}

#[test]
fn only_a_fault_gets_a_reason() {
    assert_eq!(Unavailable::Disabled.reason(), None);
    assert_eq!(
        Unavailable::NotRunning("http://127.0.0.1:7456".into())
            .reason()
            .as_deref(),
        Some("daemon not running at http://127.0.0.1:7456")
    );
}

#[test]
fn the_base_url_is_the_documented_local_daemon() {
    // The env vars the app itself reads are the only overrides; with none set
    // the default stands, so a fresh machine probes the documented port.
    if std::env::var("OD_DAEMON_URL").is_err()
        && std::env::var("OD_BIND_HOST").is_err()
        && std::env::var("OD_PORT").is_err()
    {
        assert_eq!(
            wallet::base_url(),
            format!("http://{}:{}", wallet::DEFAULT_HOST, wallet::DEFAULT_PORT)
        );
    }
    assert!(wallet::WALLET_PATH.starts_with("/api/"));
}

/// The real transport, against a stub that answers once — no app required.
#[test]
fn a_stub_daemon_answers_the_wallet() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer = [0u8; 1024];
        let _ = stream.read(&mut buffer);
        let body = r#"{"balanceUsd":5.5,"source":"vela","stale":false}"#;
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
    });
    let wallet = wallet::fetch_url(&format!("http://127.0.0.1:{port}")).expect("stub answers");
    assert_eq!(wallet.balance_usd, 5.5);
    assert_eq!(wallet.source.as_deref(), Some("vela"));
}

/// Port 1 has nothing on it, so the read degrades to a named reason — one line,
/// never an error and never a hang.
#[test]
fn a_closed_port_is_not_running_not_an_error() {
    let why = wallet::fetch_url("http://127.0.0.1:1").unwrap_err();
    assert!(
        matches!(why, Unavailable::NotRunning(_)),
        "expected NotRunning, got {why:?}"
    );
    assert!(why
        .reason()
        .unwrap_or_default()
        .contains("daemon not running"));
}
