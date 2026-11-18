// The account balance meter: the real wire shape, each named failure, and the
// hard rule that an absent credential sends no request at all. Every URL points
// at a loopback stub, so no test reaches the network.
use crate::oduse::api_wallet::{self, Credential, Unavailable};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

const REAL: &str = r#"{"balanceUsd":"1.0000","expiresAt":"2026-12-16T13:21:22.000Z",
 "updatedAt":"2026-11-16T13:21:30.404Z","billingScopeVersion":2,
 "workspaceId":"bojo3mq722vsvbiblclo937fxu","workspaceMemberId":"ugsd2d1w72keawcgq07nh1dx"}"#;

fn token() -> Credential {
    Credential::Token("session=stub".into())
}

/// A one-shot stub: `status` is the reason phrase after the code.
fn serve_once(status: &str, body: &str) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let status = status.to_string();
    let body = body.to_string();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer = [0u8; 2048];
        let _ = stream.read(&mut buffer); // consume the request, cookie included
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
    });
    (base, handle)
}

#[test]
fn the_real_body_supplies_the_balance_and_both_stamps() {
    let (base, server) = serve_once("200 OK", REAL);
    let wallet = api_wallet::fetch(&base, &token()).expect("200 parses");
    server.join().unwrap();
    assert_eq!(wallet.balance_usd, 1.0);
    assert_eq!(
        wallet.expires_at.as_deref(),
        Some("2026-12-16T13:21:22.000Z")
    );
    assert_eq!(
        wallet.updated_at.as_deref(),
        Some("2026-11-16T13:21:30.404Z")
    );
}

#[test]
fn a_decimal_string_keeps_its_value_and_a_number_still_parses() {
    let wallet = api_wallet::parse(r#"{"balanceUsd":"0.1250"}"#).expect("string decimal");
    assert_eq!(wallet.balance_usd, 0.125);
    // A wire change to a JSON number does not blank the meter.
    let wallet = api_wallet::parse(r#"{"balanceUsd":2.5}"#).expect("number");
    assert_eq!(wallet.balance_usd, 2.5);
    let why = api_wallet::parse(r#"{"updatedAt":"2026-11-16T13:21:30.404Z"}"#).unwrap_err();
    assert!(matches!(why, Unavailable::BadBody(_)), "{why:?}");
}

#[test]
fn http_errors_are_named_not_zero() {
    for (status, expected) in [("401 Unauthorized", "401"), ("404 Not Found", "404")] {
        let (base, server) = serve_once(status, "{}");
        let why = api_wallet::fetch(&base, &token()).unwrap_err();
        server.join().unwrap();
        assert!(matches!(why, Unavailable::Http(_)), "{why:?}");
        assert!(why.reason().contains(expected), "{}", why.reason());
    }
    assert!(Unavailable::Http(401)
        .reason()
        .contains("expired or invalid"));
}

#[test]
fn garbage_and_a_hung_listener_are_both_named_failures() {
    let (base, server) = serve_once("200 OK", "not json at all");
    let why = api_wallet::fetch(&base, &token()).unwrap_err();
    server.join().unwrap();
    assert!(matches!(why, Unavailable::BadBody(_)), "{why:?}");
    assert!(why.reason().contains("api bad response"));

    // The stub accepts but never answers; the injected timeout keeps this quick.
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer = [0u8; 64];
        let _ = stream.read(&mut buffer);
        std::thread::sleep(Duration::from_millis(400));
    });
    let why = api_wallet::fetch_with_timeout(&base, &token(), Duration::from_millis(60))
        .expect_err("timeout");
    server.join().unwrap();
    assert!(matches!(why, Unavailable::Transport(_)), "{why:?}");
    assert!(why.reason().contains("api transport"), "{}", why.reason());
}

#[test]
fn no_credential_means_no_request_at_all() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let result = api_wallet::fetch(&base, &Credential::Absent);
    assert!(
        matches!(result, Err(Unavailable::NoCredential)),
        "{result:?}"
    );
    assert!(
        matches!(listener.accept(), Err(e) if e.kind() == std::io::ErrorKind::WouldBlock),
        "an absent credential must not open a socket"
    );
}

#[test]
fn a_cookie_file_must_be_private_and_nonempty() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cookie");
    std::fs::write(&path, "session=abc\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let why = api_wallet::from_file(path.to_str().unwrap()).unwrap_err();
    assert!(why.contains("0600"), "{why}");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        api_wallet::from_file(path.to_str().unwrap()).unwrap(),
        "session=abc"
    );
    std::fs::write(&path, "  \n").unwrap();
    assert!(api_wallet::from_file(path.to_str().unwrap())
        .unwrap_err()
        .contains("empty"));
}
