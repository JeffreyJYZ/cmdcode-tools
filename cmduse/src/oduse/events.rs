// The desktop app's one usage record: `events_json` on an assistant message.
//
// Two events carry the whole record:
//
//   {"kind":"status","label":"model","detail":"<model id>"}
//   {"kind":"usage","inputTokens":N,"outputTokens":N,"durationMs":N}
//
// There is no cost and no cache counter — the app bills against a plan, not per
// token — so `oduse` prices each turn from the catalogue and calls it an
// estimate. A message without a `usage` event is a turn that is still streaming
// or failed, and is skipped rather than counted as zero.
//
// Split from `db.rs` so that file stays under the repo's line cap.
use serde_json::Value;

/// One message's two interesting events, extracted from its `events_json`.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub duration_ms: Option<u64>,
}

/// Parse `events_json`. `None` when the array carries no `usage` event — the
/// only signal that the turn actually completed and spent tokens.
pub fn parse_events(events_json: &str) -> Option<Turn> {
    let events: Vec<Value> = serde_json::from_str(events_json).ok()?;
    let mut model = String::new();
    let mut usage: Option<(u64, u64, Option<u64>)> = None;
    for event in &events {
        match event.get("kind").and_then(|k| k.as_str()) {
            Some("status") => {
                // Only the status whose label is `model` names the model; the
                // others are `starting` and transport chatter.
                if event.get("label").and_then(|l| l.as_str()) == Some("model") {
                    if let Some(detail) = event.get("detail").and_then(|d| d.as_str()) {
                        model = detail.to_string();
                    }
                }
            }
            Some("usage") => {
                let number = |key: &str| event.get(key).and_then(|v| v.as_u64());
                usage = Some((
                    number("inputTokens").unwrap_or(0),
                    number("outputTokens").unwrap_or(0),
                    number("durationMs"),
                ));
            }
            _ => {}
        }
    }
    let (input, output, duration_ms) = usage?;
    Some(Turn {
        model,
        input,
        output,
        duration_ms,
    })
}
