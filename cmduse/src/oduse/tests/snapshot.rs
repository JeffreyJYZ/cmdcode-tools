// The account's snapshot meter: the real body, named failures, and the proof
// that its numbers beat a local estimate when both exist. The stub is a TCP
// listener with an injected base URL, so no test reaches the network.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::fixture::{plan, report, row, NOW_MS};
use crate::oduse::api_wallet::{Credential, Unavailable};
use crate::oduse::snapshot::{self, CREDIT_TO_USD};

const REAL: &str = r#"{"schemaVersion":1,"billingScopeVersion":2,"billingMode":"shared",
 "billing":{"billingState":"active","planId":"go"},
 "plan":{"tier":"go","interval":"month","currentPeriodStart":"2026-11-16T13:21:22.000Z",
         "currentPeriodEnd":"2026-12-16T13:21:22.000Z","cancelAtPeriodEnd":false,"status":"active"},
 "wallet":{"balanceUsd":"1.0000","expiresAt":"2026-12-16T13:21:22.000Z"},
 "walletBreakdown":[{"kind":"plan_grant","amountUsd":"1.0000","expiresAt":"..."}],
 "designPlanWindows":[
   {"kind":"5h","windowStart":"2026-11-17T09:21:22.000Z","resetsAt":"2026-11-17T14:21:22.000Z",
    "remainingCredits":"4149","limitCredits":"50000"},
   {"kind":"7d","windowStart":"2026-11-16T13:21:22.000Z","resetsAt":"2026-11-23T13:21:22.000Z",
    "remainingCredits":"29491","limitCredits":"150000"}],
 "permissions":{"canUpgrade":true,"canRecharge":true}}"#;

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn serve_once(text: String) -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().expect("addr").port()
    );
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer = [0u8; 4096];
        let _ = stream.read(&mut buffer);
        let _ = stream.write_all(text.as_bytes());
    });
    (base, handle)
}

fn token() -> Credential {
    Credential::Token("test-cookie".into())
}

#[test]
fn the_real_body_parses_into_the_accounts_windows() {
    let snap = snapshot::parse(REAL).expect("parses");
    assert_eq!(snap.plan_tier.as_deref(), Some("go"));
    assert_eq!(snap.balance_usd, Some(1.0));
    assert_eq!(snap.period_end.as_deref(), Some("2026-12-16T13:21:22.000Z"));
    let five = snap.five_hour().expect("5h");
    assert_eq!(five.remaining_credits, 4149.0);
    assert_eq!(five.limit_credits, 50_000.0);
    assert_eq!(
        five.left_pct().map(|p| (p * 10.0).round() / 10.0),
        Some(8.3)
    );
    assert_eq!(five.reset_label().as_deref(), Some("14:21Z"));
    let week = snap.weekly().expect("7d");
    assert_eq!(week.remaining_credits, 29_491.0);
    assert_eq!(week.limit_credits, 150_000.0);
    assert_eq!(
        week.left_pct().map(|p| (p * 10.0).round() / 10.0),
        Some(19.7)
    );
    // The brief's ledger shape gives the unit: 43 credits = $0.0043; no raw body in repo.
    assert!((43.0 * CREDIT_TO_USD - 0.0043).abs() < 1e-9);
}

#[test]
fn http_failures_are_named_not_zero() {
    for status in ["401 Unauthorized", "403 Forbidden", "404 Not Found"] {
        let (base, handle) = serve_once(response(status, "{}"));
        let why = snapshot::fetch_with_timeout(&base, &token(), Duration::from_millis(500))
            .expect_err("named failure");
        assert!(matches!(why, Unavailable::Http(_)), "{status} -> {why:?}");
        assert!(why.reason().contains(&status[..3]), "{}", why.reason());
        handle.join().expect("stub thread");
    }
}

#[test]
fn a_garbage_body_is_a_named_fault() {
    for body in ["not json", r#"{"oops":true}"#] {
        let (base, handle) = serve_once(response("200 OK", body));
        let why = snapshot::fetch_with_timeout(&base, &token(), Duration::from_millis(500))
            .expect_err("named failure");
        assert!(matches!(why, Unavailable::BadBody(_)), "{why:?}");
        handle.join().expect("stub thread");
    }
}

#[test]
fn a_timeout_is_named_not_a_hang() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().expect("addr").port()
    );
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer = [0u8; 1024];
        let _ = stream.read(&mut buffer);
        thread::sleep(Duration::from_millis(200));
    });
    let why = snapshot::fetch_with_timeout(&base, &token(), Duration::from_millis(50))
        .expect_err("timeout is a fault");
    assert!(matches!(why, Unavailable::Transport(_)), "{why:?}");
    handle.join().expect("stub thread");
}

#[test]
fn no_credential_sends_no_request() {
    // Port 1 is closed, so a request would be a transport fault. Absence must
    // short-circuit before any socket is touched.
    let why = snapshot::fetch_with_timeout(
        "http://127.0.0.1:1",
        &Credential::Absent,
        Duration::from_millis(50),
    )
    .expect_err("absence is not a snapshot");
    assert!(matches!(why, Unavailable::NoCredential));
    assert!(why.reason().contains("no session cookie"));
}

#[test]
fn the_snapshot_beats_a_local_estimate_when_both_exist() {
    let mut local = report(&[row(NOW_MS - 60_000, "deepseek-v4.1-flash", 100, 10)]);
    let plain = crate::oduse::render::render_text(&local, &plan("go"), "/tmp/a.db", 10, false, 20);
    assert!(plain.contains("windows: local estimate — no session cookie"));
    local.snapshot = Some(snapshot::parse(REAL).expect("parses"));
    let text = crate::oduse::render::render_text(&local, &plan("go"), "/tmp/a.db", 10, false, 20);
    assert!(text.contains("$4.59 used of $5.00"), "{text}");
    assert!(text.contains("8.3% left"), "{text}");
    assert!(text.contains("resets 14:21Z"), "{text}");
    assert!(text.contains("4149/50000 credits"), "{text}");
    assert!(text.contains("windows: account snapshot"), "{text}");
    let five = text
        .lines()
        .find(|line| line.trim_start().starts_with("5-hour"))
        .expect("5-hour row");
    assert!(
        !five.contains("$10.00"),
        "local Flash cap must be gone: {five}"
    );
}
