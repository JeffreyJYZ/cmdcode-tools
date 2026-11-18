// The account's own window meters, from the console's billing snapshot.
// `GET .../workspaces/{ws}/billing/snapshot` is auth-gated by the same console
// session cookie the balance lane uses. One request returns plan, wallet and
// both `designPlanWindows`, with the server's own `resetsAt`. Those windows win
// over the local rolling cuts: they are the figures the console shows the user.
// Credential handling is reused from `api_wallet` — no second cookie path or
// secret source. No credential means no request: the local estimate stays, with
// one dim line naming the source.
use crate::oduse::api_wallet::{self, Credential, Unavailable};
pub use crate::oduse::snapshot_window::Window;

/// One credit is $0.0001. The ledger shape described in
/// `docs/plan/opendesign/briefs/oduse-snapshot-meter.md` reports
/// `listChargedUsd 0.0043` ↔ `listChargeCredits 43`, which reproduces that rate
/// (43 × 0.0001 = 0.0043). No raw ledger body is captured in this repo, so that
/// is the brief's observation, not an independently recorded response.
/// The 50,000 / 150,000 credit windows are therefore $5 / $15. The published
/// $18 / $55 Eco caps are close to that at the 0.27 multiplier ($18 × 0.27 =
/// $4.86, $55 × 0.27 = $14.85), not an exact match. Keep both the raw credits
/// and the derived dollars visible; never substitute one for the other.
pub const CREDIT_TO_USD: f64 = 0.0001;

/// `current` is the alias the console's other workspace routes accept: a
/// `workspaces/current/...` probe returns 401 (route exists), an unknown one 404.
pub const CURRENT_PATH: &str = "/api/v1/workspaces/current/billing/snapshot";

/// Which source produced the window figures. Deliberately separate from the
/// balance lane's `meter::Source`: a wallet can come from the daemon while its
/// windows come from the snapshot, so the two axes must not share one enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Snapshot,
    Local,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Snapshot => "snapshot",
            Self::Local => "local",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Snapshot {
    pub plan_tier: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub balance_usd: Option<f64>,
    pub windows: Vec<Window>,
}

impl Snapshot {
    pub fn five_hour(&self) -> Option<&Window> {
        self.windows.iter().find(|w| w.kind == "5h")
    }
    pub fn weekly(&self) -> Option<&Window> {
        self.windows.iter().find(|w| w.kind == "7d")
    }
}

#[derive(Debug, Default)]
pub struct Resolved {
    pub snapshot: Option<Snapshot>,
    pub error: Option<String>,
}

/// An explicit `OD_WORKSPACE` opts into a named workspace; `current` is the
/// default so a single cookie works wherever the console's own routes work.
pub fn path() -> String {
    match std::env::var("OD_WORKSPACE") {
        Ok(ws) if !ws.trim().is_empty() => {
            format!("/api/v1/workspaces/{}/billing/snapshot", ws.trim())
        }
        _ => CURRENT_PATH.to_string(),
    }
}

/// The snapshot is optional and fails soft. A missing credential is silent;
/// the renderer emits the dim line. A failing one names its reason, never a zero.
pub fn resolve(session_path: Option<&str>, api_base: &str) -> Resolved {
    let credential = api_wallet::credential(session_path);
    if matches!(credential, Credential::Absent) {
        return Resolved::default();
    }
    match fetch(api_base, &credential) {
        Ok(snapshot) => Resolved {
            snapshot: Some(snapshot),
            error: None,
        },
        Err(why) => Resolved {
            snapshot: None,
            error: Some(why.reason()),
        },
    }
}

pub fn fetch(base: &str, cred: &Credential) -> Result<Snapshot, Unavailable> {
    fetch_with_timeout(
        base,
        cred,
        std::time::Duration::from_millis(api_wallet::TIMEOUT_MS),
    )
}

/// Same call with an injected timeout, so a stub's hung listener can be tested
/// in milliseconds instead of the two seconds a real request gets.
pub fn fetch_with_timeout(
    base: &str,
    cred: &Credential,
    timeout: std::time::Duration,
) -> Result<Snapshot, Unavailable> {
    let token = match cred {
        Credential::Absent => return Err(Unavailable::NoCredential),
        Credential::Invalid(why) => return Err(Unavailable::Credential(why.clone())),
        Credential::Token(token) => token,
    };
    let url = format!("{}{}", base.trim_end_matches('/'), path());
    let response = ureq::get(&url)
        .set("Cookie", token)
        .set(
            "User-Agent",
            &format!("oduse/{}", env!("CARGO_PKG_VERSION")),
        )
        .timeout(timeout)
        .call();
    match response {
        Ok(response) => match response.into_string() {
            Ok(body) => parse(&body),
            Err(e) => Err(Unavailable::Transport(format!("read: {e}"))),
        },
        Err(ureq::Error::Status(status, _)) => Err(Unavailable::Http(status)),
        Err(e) => Err(Unavailable::Transport(short_error(&e))),
    }
}

/// `ureq`'s message carries the whole request line (and so the URL); report
/// only its cause, which is the part a dashboard line can show.
fn short_error(error: &ureq::Error) -> String {
    let text = error.to_string();
    text.rsplit(": ").next().unwrap_or(&text).to_string()
}

/// Parse the snapshot body. Credits arrive as decimal strings (`"4149"`), the
/// same precision trap as `balanceUsd`; a JSON number is accepted too so a wire
/// change does not blank the meter.
pub fn parse(body: &str) -> Result<Snapshot, Unavailable> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| Unavailable::BadBody(e.to_string()))?;
    let windows = value
        .get("designPlanWindows")
        .and_then(|v| v.as_array())
        .ok_or_else(|| Unavailable::BadBody("no designPlanWindows".into()))?
        .iter()
        .map(window)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Snapshot {
        plan_tier: pointer(&value, "/billing/planId").or_else(|| pointer(&value, "/plan/tier")),
        period_start: pointer(&value, "/plan/currentPeriodStart"),
        period_end: pointer(&value, "/plan/currentPeriodEnd"),
        balance_usd: pointer(&value, "/wallet/balanceUsd").and_then(|s| s.parse::<f64>().ok()),
        windows,
    })
}

fn window(value: &serde_json::Value) -> Result<Window, Unavailable> {
    let kind = value
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Unavailable::BadBody("window without kind".into()))?
        .to_string();
    Ok(Window {
        kind,
        remaining_credits: credit(value, "remainingCredits")?,
        limit_credits: credit(value, "limitCredits")?,
        window_start: pointer(value, "windowStart"),
        resets_at: pointer(value, "resetsAt"),
    })
}

fn credit(value: &serde_json::Value, key: &str) -> Result<f64, Unavailable> {
    value
        .get(key)
        .and_then(|v| {
            v.as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| v.as_f64())
        })
        .filter(|n| n.is_finite() && *n >= 0.0)
        .ok_or_else(|| Unavailable::BadBody(format!("no {key}")))
}

fn pointer(value: &serde_json::Value, key: &str) -> Option<String> {
    let node = if key.starts_with('/') {
        value.pointer(key)
    } else {
        value.get(key)
    };
    node.and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}
