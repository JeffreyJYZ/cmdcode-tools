// The account's own wallet figure, from OpenDesign's console API.
//
// `GET https://amr-api.open-design.ai/api/v1/wallet/balance` is authenticated
// by the console **session cookie**, never the model API key. This module never
// reads a browser: the token is supplied by the user (env or a 0600 file) and
// sent as one `Cookie` header. Its value is never logged, stored or echoed in an
// error — only the failure's name is.
//
// The balance is a number the account reports, not a window meter, so it stays
// beside the windows. There is no per-window usage endpoint (all the plausible
// ones are 404), which is why the windows themselves remain local estimates.
pub const DEFAULT_BASE: &str = "https://amr-api.open-design.ai";
pub const BALANCE_PATH: &str = "/api/v1/wallet/balance";
/// A remote call, unlike the localhost daemon; still short beside a 5s poll.
pub const TIMEOUT_MS: u64 = 2000;

/// What the user supplied. `Absent` is not a fault — it means "keep today's
/// behaviour, no request at all". `Invalid` is a bad file we refuse to use.
#[derive(Debug, Clone, PartialEq)]
pub enum Credential {
    Absent,
    Token(String),
    Invalid(String),
}

/// The API snapshot, reduced to what a dashboard needs. The two timestamps are
/// carried through verbatim: the frame shows the expiry, `--json` carries both.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ApiWallet {
    pub balance_usd: f64,
    pub expires_at: Option<String>,
    pub updated_at: Option<String>,
}

/// A named failure, never a zero.
#[derive(Debug, Clone, PartialEq)]
pub enum Unavailable {
    NoCredential,
    Credential(String),
    Http(u16),
    BadBody(String),
    Transport(String),
}

impl Unavailable {
    pub fn reason(&self) -> String {
        match self {
            Unavailable::NoCredential => "no session cookie".into(),
            Unavailable::Credential(why) => format!("api credential ({why})"),
            Unavailable::Http(401) => "api HTTP 401 (session cookie expired or invalid)".into(),
            Unavailable::Http(status) => format!("api HTTP {status}"),
            Unavailable::BadBody(why) => format!("api bad response ({why})"),
            Unavailable::Transport(why) => format!("api transport ({why})"),
        }
    }
}

/// `$OD_API_URL` overrides the host for a self-hosted proxy or a test; the path
/// is fixed so a mistyped URL cannot send a cookie somewhere unexpected.
pub fn base_url() -> String {
    std::env::var("OD_API_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE.to_string())
}

/// Credential from `OD_SESSION`, then `OD_SESSION_COOKIE`, then a user file.
/// Env wins over the flag because a secret in the environment is the common
/// case; a file is the fallback for shells that cannot hold an env var safely.
pub fn credential(session_path: Option<&str>) -> Credential {
    for key in ["OD_SESSION", "OD_SESSION_COOKIE"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() {
                return Credential::Token(value.to_string());
            }
        }
    }
    match session_path {
        None => Credential::Absent,
        Some(path) => match from_file(path) {
            Ok(token) => Credential::Token(token),
            Err(why) => Credential::Invalid(why),
        },
    }
}

/// Read the cookie the user put in a file. Refuse a file other processes can
/// read: a credential worth protecting is not one we accept from a 0644 path.
pub fn from_file(path: &str) -> Result<String, String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("{}: {e}", crate::oduse::render::shorten(path)))?;
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err("file must be mode 0600".into());
    }
    let body = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let token = body.trim();
    if token.is_empty() {
        return Err("file is empty".into());
    }
    Ok(token.to_string())
}

/// One request, with the credential explicit so a test can prove that an absent
/// one sends nothing at all.
pub fn fetch(base: &str, cred: &Credential) -> Result<ApiWallet, Unavailable> {
    fetch_with_timeout(base, cred, std::time::Duration::from_millis(TIMEOUT_MS))
}

/// Same, with an injected timeout — the stub's hung listener needs milliseconds,
/// not the two seconds a real call gets.
pub fn fetch_with_timeout(
    base: &str,
    cred: &Credential,
    timeout: std::time::Duration,
) -> Result<ApiWallet, Unavailable> {
    let token = match cred {
        Credential::Absent => return Err(Unavailable::NoCredential),
        Credential::Invalid(why) => return Err(Unavailable::Credential(why.clone())),
        Credential::Token(token) => token,
    };
    let url = format!("{}{}", base.trim_end_matches('/'), BALANCE_PATH);
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
        // An error body can quote the request; report the status, not the body.
        Err(ureq::Error::Status(status, _)) => Err(Unavailable::Http(status)),
        Err(e) => Err(Unavailable::Transport(short_error(&e))),
    }
}

/// `ureq`'s message carries the whole request line (and so the URL); keep only
/// its cause, which is the part a dashboard line can show.
fn short_error(error: &ureq::Error) -> String {
    let text = error.to_string();
    text.rsplit(": ").next().unwrap_or(&text).to_string()
}

/// Parse the API snapshot. `balanceUsd` is a decimal **string** (`"1.0000"`),
/// not a JSON number; a number is accepted too so a wire change does not blank
/// the meter, but the string form is the documented one.
pub fn parse(body: &str) -> Result<ApiWallet, Unavailable> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| Unavailable::BadBody(e.to_string()))?;
    let balance_usd = value
        .get("balanceUsd")
        .and_then(|b| {
            b.as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| b.as_f64())
        })
        .filter(|v| v.is_finite())
        .ok_or_else(|| Unavailable::BadBody("no balanceUsd".into()))?;
    Ok(ApiWallet {
        balance_usd,
        expires_at: text(&value, "expiresAt"),
        updated_at: text(&value, "updatedAt"),
    })
}

fn text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}
