// Which meter produced the wallet figure. The API is preferred when a
// credential exists (it works with the app closed and is the account's own
// number); the desktop daemon is the fallback; neither is a zero. Every path
// is optional, so a run without either still has a full dashboard.
use crate::oduse::api_wallet::{self, Credential};
use crate::oduse::wallet::Wallet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Api,
    Daemon,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Api => "api",
            Source::Daemon => "daemon",
        }
    }
}

#[derive(Debug, Default)]
pub struct Resolved {
    pub wallet: Option<Wallet>,
    pub error: Option<String>,
    pub source: Option<Source>,
}

/// Resolve once per run (and again each watch tick).
///
/// `--no-wallet` is a choice: no request, no reason. An absent credential is
/// just as quiet — the old daemon-only behaviour, with no HTTP call made. A
/// supplied-but-failing credential falls through to the daemon, and if that
/// fails too both reasons are named so a dead token is not mistaken for an
/// app that is merely closed.
pub fn resolve(no_wallet: bool, session_path: Option<&str>, api_base: &str) -> Resolved {
    if no_wallet {
        return Resolved::default();
    }
    let credential = api_wallet::credential(session_path);
    if !matches!(credential, Credential::Absent) {
        match api_wallet::fetch(api_base, &credential) {
            Ok(api) => {
                let wallet = Wallet {
                    balance_usd: api.balance_usd,
                    expires_at: api.expires_at,
                    updated_at: api.updated_at,
                    ..Default::default()
                };
                return Resolved {
                    wallet: Some(wallet),
                    error: None,
                    source: Some(Source::Api),
                };
            }
            // Keep the API's reason for the case where both routes fail. A
            // daemon success still says `daemon`, so the frame never credits
            // the API with a number it did not supply.
            Err(why) => {
                let reason = why.reason();
                return match crate::oduse::wallet::fetch() {
                    Ok(wallet) => Resolved {
                        wallet: Some(wallet),
                        error: None,
                        source: Some(Source::Daemon),
                    },
                    Err(daemon) => Resolved {
                        wallet: None,
                        error: Some(join(&reason, daemon.reason())),
                        source: None,
                    },
                };
            }
        }
    }
    match crate::oduse::wallet::fetch() {
        Ok(wallet) => Resolved {
            wallet: Some(wallet),
            error: None,
            source: Some(Source::Daemon),
        },
        Err(daemon) => Resolved {
            wallet: None,
            error: daemon.reason(),
            source: None,
        },
    }
}

fn join(api: &str, daemon: Option<String>) -> String {
    match daemon {
        Some(reason) => format!("{api} · {reason}"),
        None => api.to_string(),
    }
}
