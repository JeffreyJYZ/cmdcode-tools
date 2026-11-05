use cmduse_core::SubscriptionsResp;
pub use cmduse_core::{Credits, CreditsResp, SubData, UsageSummary, Window, WindowLimits};
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.commandcode.ai";

/// The key the dashboard starts with: the most current one this machine can
/// offer (see [`crate::credentials`]). A stale head is recovered by [`get`],
/// which walks the rest of the list when the API refuses it.
pub fn api_key() -> std::io::Result<String> {
    crate::credentials::candidates()
        .into_iter()
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no API key"))
}

/// `key` first, then the other candidates — the caller's key is a hint, and a
/// 401 on it moves to the next rather than failing the dashboard.
fn candidates_from(key: &str) -> Vec<String> {
    let mut all = crate::credentials::candidates();
    all.sort_by_key(|candidate| candidate != key);
    all.dedup();
    if all.is_empty() {
        all.push(key.to_string());
    }
    all
}

fn get(path: &str, key: &str) -> Result<Vec<u8>, String> {
    let mut last_err = String::new();
    for candidate in candidates_from(key) {
        match get_with(path, &candidate) {
            Ok(body) => return Ok(body),
            // 401 = this key is not the account's current one; try the next.
            Err((error, true)) => last_err = error,
            Err((error, _)) => return Err(error),
        }
    }
    Err(last_err)
}

/// One request against one key. The flag says the failure was an auth refusal,
/// which is the only kind the caller may retry with a different key.
fn get_with(path: &str, key: &str) -> Result<Vec<u8>, (String, bool)> {
    const MAX_RETRIES: u32 = 5;
    const BASE_DELAY_MS: u64 = 1000;
    const MAX_DELAY_MS: u64 = 8000;

    let mut last_err = String::new();
    let mut unauthorized = false;
    for attempt in 0..=MAX_RETRIES {
        let resp = ureq::get(&format!("{API_BASE}{path}"))
            .set("Authorization", &format!("Bearer {key}"))
            .timeout(std::time::Duration::from_secs(15))
            .call();

        let mut retry_after: Option<u64> = None;
        match resp {
            Ok(resp) => {
                const MAX_BODY: u64 = 10 * 1024 * 1024;
                let mut buf = Vec::new();
                match resp.into_reader().take(MAX_BODY).read_to_end(&mut buf) {
                    // hitting the cap means the body was truncated and will
                    // never parse — fail loudly instead of retrying a huge body
                    Ok(n) if n as u64 == MAX_BODY => {
                        last_err =
                            format!("{path}: response exceeds {} MiB", MAX_BODY / 1024 / 1024);
                        break;
                    }
                    Ok(_) => return Ok(buf),
                    Err(e) => last_err = format!("{path}: read error: {e}"),
                }
            }
            Err(e) => {
                last_err = format!("{path}: {e}");
                // Transport = network/TLS/socket blip (always retry); Status =
                // 429/5xx retry, other 4xx client errors are fatal.
                let is_transient = match &e {
                    ureq::Error::Status(code, resp) => {
                        unauthorized = *code == 401;
                        // honor a numeric Retry-After (seconds); capped so a
                        // hostile/huge value can't stall the watch loop for long.
                        // ponytail: HTTP-date form ignored — servers use seconds
                        // for 429. upgrade: parse the date form if one shows up.
                        if *code == 429 {
                            retry_after = resp
                                .header("Retry-After")
                                .and_then(|v| v.trim().parse::<u64>().ok())
                                .map(|s| s.min(60));
                        }
                        *code == 429 || (500..600).contains(code)
                    }
                    ureq::Error::Transport(_) => true,
                };
                if unauthorized || !is_transient || attempt == MAX_RETRIES {
                    break;
                }
            }
        }

        if attempt < MAX_RETRIES {
            let backoff = std::cmp::min(BASE_DELAY_MS * (1u64 << attempt), MAX_DELAY_MS);
            let delay = retry_after.map_or(backoff, |s| s * 1000);
            // jitter de-syncs retries from other clients; subsec nanos is plenty
            let jitter = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| u64::from(d.subsec_nanos()) % 500)
                .unwrap_or(0);
            std::thread::sleep(std::time::Duration::from_millis(delay + jitter));
        }
    }
    Err((last_err, unauthorized))
}

use std::io::Read;

pub fn subscriptions(key: &str) -> Result<SubData, String> {
    let d: SubscriptionsResp = serde_json::from_slice(&get("/alpha/billing/subscriptions", key)?)
        .map_err(|e| format!("subscriptions: {e}"))?;
    Ok(d.data_or_free())
}

pub fn credits(key: &str) -> Result<CreditsResp, String> {
    serde_json::from_slice(&get("/alpha/billing/credits", key)?)
        .map_err(|e| format!("credits: {e}"))
}

pub fn summary(key: &str) -> Result<UsageSummary, String> {
    serde_json::from_slice(&get("/alpha/usage/summary", key)?).map_err(|e| format!("summary: {e}"))
}

/// Fetch `/alpha/usage/summary?since=<ISO>` and return parsed summary.
/// Retries on transient errors (uses same logic as `get`).
pub fn summary_since(since: &str, key: &str) -> Result<UsageSummary, String> {
    serde_json::from_slice(&get(&format!("/alpha/usage/summary?since={since}"), key)?)
        .map_err(|e| format!("summary since={since}: {e}"))
}

#[derive(Deserialize, Serialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub context_length: Option<u64>,
    #[serde(default)]
    pub owned_by: Option<String>,
}

#[derive(Deserialize)]
struct ModelsResp {
    #[serde(default)]
    data: Vec<ModelInfo>,
}

/// Live model list from the provider endpoint (/provider/v1/models) — the
/// same list the opencode plugin gates per plan. Raw here, no plan filter.
pub fn models(key: &str) -> Result<Vec<ModelInfo>, String> {
    let r: ModelsResp =
        serde_json::from_slice(&get("/provider/v1/models", key)?).map_err(|e| e.to_string())?;
    Ok(r.data)
}
