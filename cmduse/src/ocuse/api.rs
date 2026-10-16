// OpenCode Go's own usage endpoint — the numbers the console shows.
//
// `GET https://opencode.ai/zen/go/v1/usage` with a Go key answers the console's
// three meters:
//
//   {"usage":{"rolling":{"status":"ok","percent":2,"resetsAt":"…Z"},
//             "weekly":{…}, "monthly":{…}}}
//
// They are authoritative in a way a local reconstruction cannot be, because the
// server's own windows are not the ones the store can be sliced into:
//
//   * the 5-hour window is a *block* that resets at its own instant, not
//     `now - 5h` (measured 2026-10-16: `resetsAt` sat 4h31m ahead of now, so the
//     block had opened 29 minutes earlier, while the last 5h of requests were
//     worth nine times the block's reported share);
//   * the weekly window is anchored to Monday 00:00 UTC, not a rolling 7 days;
//   * the monthly window is the subscription anniversary (Oct 13 09:14:35 →
//     Nov 13 09:14:35), not the calendar month;
//   * and the server meters with its own price basis, which the store's recorded
//     `cost` is not — fitted from 9952 real rows its rates land *between* the
//     docs' off-peak and peak sheets ($0.1529/$0.8717/$0.0039 per 1M against
//     0.15/0.60/0.003 and 0.30/1.20/0.006).
//
// The gap that produced is exactly the "weekly and 5h are wrong" report: on the
// same account at the same minute, local derivation said 9.4% / 42.5% / 21.3%
// where the console said 2% / 58% / 29%.
//
// No key (an opencode install without Go), a non-Go key (entitlement error), or
// any network failure returns `None` at the call site, and the caller keeps its
// local estimate.
use serde::Deserialize;

/// The Go usage endpoint — the same source the console reads.
pub const USAGE_URL: &str = "https://opencode.ai/zen/go/v1/usage";

/// One of the account's three meters: what share of the window's limit is gone,
/// and when it resets.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Meter {
    /// The server's own word for the state ("ok" when inside the limit); kept
    /// verbatim so an unrecognised one is still surfaced rather than swallowed.
    pub status: String,
    /// Percent of the window's limit already used — the console's number.
    pub percent: f64,
    #[serde(rename = "resetsAt")]
    pub resets_at: Option<String>,
}

impl Meter {
    /// The reset instant in epoch ms; `None` when the server sends no timestamp.
    pub fn reset_ms(&self) -> Option<i64> {
        self.resets_at
            .as_deref()
            .and_then(cmduse_core::dates::parse_iso_utc)
            .map(|ms| ms as i64)
    }

    /// Over the limit: either the server says so, or the percent is at 100.
    pub fn exceeded(&self) -> bool {
        self.percent >= 100.0 || !self.status.eq_ignore_ascii_case("ok")
    }
}

/// The account's three meters. Field names are the endpoint's, so `rolling` is
/// the 5-hour window.
#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub rolling: Meter,
    pub weekly: Meter,
    pub monthly: Meter,
}

#[derive(Deserialize)]
struct Envelope {
    usage: Usage,
}

/// The Go key: `OCUSE_API_KEY`, else `OPENCODE_API_KEY`, else the `opencode-go`
/// entry of opencode's own auth file — the same credential `/connect` stores.
pub fn key() -> Option<String> {
    for var in ["OCUSE_API_KEY", "OPENCODE_API_KEY"] {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }
    let path = format!("{}/auth.json", crate::ocuse::db::opencode_home());
    let text = std::fs::read_to_string(path).ok()?;
    let auth: serde_json::Value = serde_json::from_str(&text).ok()?;
    auth["opencode-go"]["key"]
        .as_str()
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

/// Fetch the account's meters. One attempt: the caller always has a local
/// fallback, and in watch mode a previous answer, so a retry ladder would only
/// stall the frame it is drawn into.
pub fn fetch(key: &str) -> Result<Usage, String> {
    let response = ureq::get(USAGE_URL)
        .set("Authorization", &format!("Bearer {key}"))
        // Go's docs ask clients to identify themselves rather than arrive as an
        // anonymous HTTP library.
        .set(
            "User-Agent",
            &format!("ocuse/{}", env!("CARGO_PKG_VERSION")),
        )
        .timeout(std::time::Duration::from_secs(10))
        .call();
    match response {
        Ok(response) => {
            let body = response
                .into_string()
                .map_err(|e| format!("usage: read: {e}"))?;
            serde_json::from_str::<Envelope>(&body)
                .map(|envelope| envelope.usage)
                .map_err(|e| format!("usage: {e}"))
        }
        // A key without a Go subscription is an entitlement refusal, not a
        // transport fault: say so, since the fallback is otherwise silent.
        Err(ureq::Error::Status(code, _)) if code == 401 || code == 403 => {
            Err(format!("usage: HTTP {code} (key has no Go subscription)"))
        }
        Err(e) => Err(format!("usage: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exactly what the endpoint answered for this account on 2026-10-16.
    const LIVE: &str = r#"{"usage":{
        "rolling":{"status":"ok","percent":2,"resetsAt":"2026-10-16T10:57:34.000Z"},
        "weekly":{"status":"ok","percent":58,"resetsAt":"2026-10-19T00:00:00.000Z"},
        "monthly":{"status":"ok","percent":29,"resetsAt":"2026-11-13T09:14:35.000Z"}}}"#;

    fn parse(text: &str) -> Usage {
        serde_json::from_str::<Envelope>(text)
            .expect("fixture parses")
            .usage
    }

    #[test]
    fn parses_the_live_response() {
        let usage = parse(LIVE);
        assert_eq!(usage.rolling.percent, 2.0);
        assert_eq!(usage.weekly.percent, 58.0);
        assert_eq!(usage.monthly.percent, 29.0);
        assert!(!usage.weekly.exceeded());
    }

    #[test]
    fn resets_at_becomes_epoch_ms() {
        let usage = parse(LIVE);
        // 2026-10-19T00:00:00Z — the Monday the weekly window turns over.
        assert_eq!(usage.weekly.reset_ms(), Some(1_792_368_000_000));
        // 2026-11-13T09:14:35Z — the subscription anniversary.
        assert_eq!(usage.monthly.reset_ms(), Some(1_794_561_275_000));
        assert_eq!(
            usage.rolling.resets_at.as_deref(),
            Some("2026-10-16T10:57:34.000Z")
        );
    }

    #[test]
    fn a_missing_reset_is_not_an_error() {
        let usage = parse(
            r#"{"usage":{
            "rolling":{"status":"ok","percent":0},
            "weekly":{"status":"ok","percent":0,"resetsAt":null},
            "monthly":{"status":"ok","percent":0,"resetsAt":null}}}"#,
        );
        assert_eq!(usage.rolling.reset_ms(), None);
    }

    #[test]
    fn a_non_ok_status_reads_as_exceeded() {
        let usage = parse(
            r#"{"usage":{
            "rolling":{"status":"rate_limited","percent":100,"resetsAt":null},
            "weekly":{"status":"ok","percent":99.9,"resetsAt":null},
            "monthly":{"status":"ok","percent":100,"resetsAt":null}}}"#,
        );
        assert!(usage.rolling.exceeded(), "status is not ok");
        assert!(!usage.weekly.exceeded(), "99.9% is not over");
        assert!(usage.monthly.exceeded(), "100% is over");
    }

    #[test]
    fn the_env_override_wins_over_null() {
        // The env path is the documented way to point ocuse at another account.
        std::env::set_var("OCUSE_API_KEY", "env-key");
        assert_eq!(key().as_deref(), Some("env-key"));
        std::env::remove_var("OCUSE_API_KEY");
    }
}
