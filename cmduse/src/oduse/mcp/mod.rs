// MCP stdio server for oduse — the same JSON-RPC profile the other three speak
// (initialize / ping / tools/list / tools/call), so a host that already drives
// cmduse can drive this. Tools mirror the CLI: usage, plans, models, daily,
// hourly, session, model.
//
// Two source-forced absences, both stated in the schemas rather than left to
// guesswork: `models` takes no `gated` (OpenDesign does not restrict which models
// a plan may call, it prices them differently), and the wallet is resolved once
// by the caller and handed in — the same rule `ocuse` applies to its account
// meters, so a `usage` call shows the same rows the dashboard does without a
// second daemon round-trip per tool call.
mod call;
mod tools;

use crate::oduse::meter::Source;
use crate::oduse::wallet::Wallet;
use serde_json::{json, Value};

pub use tools::tools;

const PROTOCOL_VERSION: &str = "2025-06-18";

/// What every tool call needs, resolved once by the caller.
#[derive(Clone, Copy)]
pub struct Settings<'a> {
    pub db_path: &'a str,
    /// The harness store (`opencode.db`), read as the second source.
    pub opencode_path: &'a str,
    pub days: i64,
    pub tz_secs: i64,
    pub colour: bool,
    pub plan: &'a str,
    pub period_start: Option<i64>,
    pub wallet: Option<&'a Wallet>,
    pub wallet_error: Option<&'a str>,
    pub wallet_source: Option<Source>,
}

/// Serve stdin -> stdout until the host closes the pipe.
pub fn run(settings: Settings) {
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue; // not JSON: ignore, a host bug shouldn't kill the server
        };
        if let Some(response) = handle(&msg, &settings) {
            if writeln!(out, "{response}").is_err() {
                break; // stdout closed: host is gone
            }
            out.flush().ok();
        }
    }
}

/// One message in, one response out; `None` for notifications (no `id`).
pub fn handle(msg: &Value, settings: &Settings) -> Option<Value> {
    let method = msg.get("method")?.as_str()?;
    let id = msg.get("id")?;
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg
                .pointer("/params/protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "oduse", "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => call::tool_call(msg, settings),
        other => Err((-32601, format!("method not found: {other}"))),
    };
    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": code, "message": message },
        }),
    })
}
