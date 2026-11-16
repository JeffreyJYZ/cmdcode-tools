// The Open Design desktop app's local daemon — the one server-side number.
//
// The daemon serves `GET /api/integrations/vela/wallet` on 127.0.0.1 (7456 by
// default) with no local auth, and answers a snapshot the app built from the
// Vela control key it stored at sign-in: `{balanceUsd, source, profile, user,
// stale}`, plus an `error` object when that key expired (`unauthorized`) or the
// upstream is down (`upstream`). `?refresh=1` bypasses its short cache; `oduse`
// does not bother — a 5s dashboard poll is already fresh enough.
//
// The control key is never read, copied or printed here: this module talks to
// localhost and nothing else, which is the whole reason it can exist without a
// credential of its own.
//
// Strictly optional. The app is often closed, so a closed daemon is a named
// reason on one line and never an error, and the connect timeout is short so a
// dead port costs milliseconds rather than a stalled frame.
pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 7456;
pub const WALLET_PATH: &str = "/api/integrations/vela/wallet";
/// A closed port refuses immediately; this only bounds a hung listener.
pub const TIMEOUT_MS: u64 = 300;

/// The wallet snapshot, reduced to what a dashboard needs.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Wallet {
    pub balance_usd: f64,
    pub source: Option<String>,
    pub profile: Option<String>,
    pub user: Option<String>,
    /// The daemon served a cached snapshot; the balance may have moved since.
    pub stale: bool,
}

/// Why the wallet is absent. `Disabled` is a choice, so it says nothing.
#[derive(Debug, Clone, PartialEq)]
pub enum Unavailable {
    /// `--no-wallet`: the daemon route was switched off on purpose.
    Disabled,
    /// Nothing is listening: the app is closed. Carries the base URL tried.
    NotRunning(String),
    /// The daemon answered with its own refusal — an expired control key, or an
    /// upstream fault. Its words, not ours.
    Refused(String),
    /// A body that would not parse, or a listener that hung.
    Transport(String),
}

impl Unavailable {
    /// The reason itself, or `None` when the route was switched off on purpose
    /// (a deliberate choice is not a fault to report). The `wallet: ` label
    /// belongs to the renderer, which owns the line — a reason carrying it would
    /// print twice.
    pub fn reason(&self) -> Option<String> {
        match self {
            Unavailable::Disabled => None,
            Unavailable::NotRunning(base) => Some(format!("daemon not running at {base}")),
            Unavailable::Refused(why) => Some(why.clone()),
            Unavailable::Transport(why) => Some(why.clone()),
        }
    }
}

/// Where the daemon listens: `$OD_DAEMON_URL` wins, else the app's own
/// `$OD_BIND_HOST` / `$OD_PORT`, else the defaults.
pub fn base_url() -> String {
    if let Ok(url) = std::env::var("OD_DAEMON_URL") {
        let url = url.trim();
        if !url.is_empty() {
            return url.trim_end_matches('/').to_string();
        }
    }
    let host = std::env::var("OD_BIND_HOST")
        .ok()
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_HOST.to_string());
    let port = std::env::var("OD_PORT")
        .ok()
        .and_then(|p| p.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    format!("http://{host}:{port}")
}

/// Ask the local daemon for the wallet, once.
pub fn fetch() -> Result<Wallet, Unavailable> {
    fetch_url(&base_url())
}

/// Same, against an explicit base URL — the seam the tests drive.
pub fn fetch_url(base: &str) -> Result<Wallet, Unavailable> {
    let base = base.trim_end_matches('/');
    let url = format!("{base}{WALLET_PATH}");
    let response = ureq::get(&url)
        .set(
            "User-Agent",
            &format!("oduse/{}", env!("CARGO_PKG_VERSION")),
        )
        .timeout(std::time::Duration::from_millis(TIMEOUT_MS))
        .call();
    match response {
        Ok(response) => match response.into_string() {
            Ok(body) => parse(&body),
            Err(e) => Err(Unavailable::Transport(format!("read: {e}"))),
        },
        // The daemon answers its own error envelope with an HTTP status too, so
        // read the body before deciding: `unauthorized` is a status a person can
        // act on ("sign in again"), not a transport fault.
        Err(ureq::Error::Status(status, response)) => match response.into_string() {
            Ok(body) => parse(&body).map_err(|why| match why {
                Unavailable::Refused(why) => Unavailable::Refused(why),
                _ => Unavailable::Refused(format!("HTTP {status}")),
            }),
            Err(_) => Err(Unavailable::Refused(format!("HTTP {status}"))),
        },
        Err(e) => Err(Unavailable::NotRunning(format!(
            "{base} ({})",
            short_error(&e)
        ))),
    }
}

/// `ureq`'s message carries the whole request line; the dashboard has one line,
/// so keep only the cause.
fn short_error(error: &ureq::Error) -> String {
    let text = error.to_string();
    text.rsplit(": ").next().unwrap_or(&text).to_string()
}

/// Parse a wallet snapshot. The daemon's `error` object wins when present, in
/// its own words.
pub fn parse(body: &str) -> Result<Wallet, Unavailable> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| Unavailable::Transport(format!("{e}")))?;
    if let Some(error) = value.get("error").filter(|e| !e.is_null()) {
        return Err(Unavailable::Refused(refusal(error)));
    }
    let Some(balance_usd) = value.get("balanceUsd").and_then(|b| b.as_f64()) else {
        return Err(Unavailable::Transport(
            "snapshot carries no balanceUsd".into(),
        ));
    };
    Ok(Wallet {
        balance_usd,
        source: text(&value, "source"),
        profile: text(&value, "profile"),
        user: user_label(value.get("user")),
        stale: value
            .get("stale")
            .and_then(|s| s.as_bool())
            .unwrap_or(false),
    })
}

/// `{"kind":"unauthorized","message":"…"}` — the kind is the actionable half.
fn refusal(error: &serde_json::Value) -> String {
    let kind = ["kind", "code", "type"]
        .iter()
        .find_map(|key| error.get(key).and_then(|v| v.as_str()))
        .unwrap_or("refused");
    match error.get("message").and_then(|m| m.as_str()) {
        Some(message) if !message.is_empty() => format!("{kind} ({message})"),
        _ => kind.to_string(),
    }
}

fn text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The signed-in user, as a display label: the daemon may send a name, an email,
/// or an object holding either.
fn user_label(user: Option<&serde_json::Value>) -> Option<String> {
    let user = user?;
    if let Some(text) = user.as_str().filter(|s| !s.is_empty()) {
        return Some(text.to_string());
    }
    for key in ["email", "name", "handle"] {
        if let Some(text) = user.get(key).and_then(|v| v.as_str()) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}
