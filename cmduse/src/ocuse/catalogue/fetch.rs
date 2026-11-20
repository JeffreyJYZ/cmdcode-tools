// The one HTTP call: `GET /zen/go/v1/models`, anonymously.
//
// Sibling of `ocuse::api`'s fetch and bounded the same way, with two
// differences forced by what the catalogue is: it needs no key (the endpoint
// answers 200 without one, which is why mpc reads it every run), and a
// transport fault gets exactly one retry — a 5s watch frame is redrawn from a
// cached answer, so a retry ladder would only stall it. A 4xx/5xx is final: the
// endpoint refusing is not a blip, and retrying it just doubles the wait.
use std::time::Duration;

/// The Go catalogue endpoint — membership, rates and each plan's monthly limits.
pub const MODELS_URL: &str = "https://opencode.ai/zen/go/v1/models";

/// Long enough for a slow link, short enough that `-1` still feels immediate.
const TIMEOUT: Duration = Duration::from_secs(8);

/// Why one attempt failed. Only `Transport` is worth another try.
enum Fault {
    Transport(String),
    Refused(u16),
}

impl Fault {
    fn message(self) -> String {
        match self {
            Fault::Transport(why) => why,
            Fault::Refused(status) => format!("catalogue: HTTP {status}"),
        }
    }
}

/// The payload body, or a message naming why there is none.
pub fn zen_go() -> Result<String, String> {
    match once() {
        Ok(body) => Ok(body),
        Err(Fault::Transport(why)) => once().map_err(|again| match again {
            // Name both attempts: one message per run, and a first try that
            // failed differently is information, not noise.
            Fault::Refused(status) => format!("catalogue: HTTP {status} (after: {why})"),
            Fault::Transport(second) => second,
        }),
        Err(refused) => Err(refused.message()),
    }
}

fn once() -> Result<String, Fault> {
    let response = ureq::get(MODELS_URL)
        // Go's docs ask clients to identify themselves rather than arrive as an
        // anonymous HTTP library; this names the tool and its version.
        .set(
            "User-Agent",
            concat!("ocuse/", env!("CARGO_PKG_VERSION"), " (cmduse)"),
        )
        .timeout(TIMEOUT)
        .call();
    match response {
        Ok(response) => response
            .into_string()
            .map_err(|e| Fault::Transport(format!("catalogue: read: {e}"))),
        Err(ureq::Error::Status(status, _)) => Err(Fault::Refused(status)),
        Err(e) => Err(Fault::Transport(format!("catalogue: {e}"))),
    }
}
