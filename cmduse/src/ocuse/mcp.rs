// MCP stdio server for ocuse — the same JSON-RPC profile cmduse speaks
// (initialize / ping / tools/list / tools/call), so a host that already drives
// cmduse can drive this. Tools mirror the CLI: usage, plans, daily, hourly,
// session, model.
//
// Read-only, like everything else here: it reads opencode.db and the generated
// catalogue, never the network.
use crate::ocuse::{db, render, window, zen};
use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "2025-06-18";

/// Serve stdin -> stdout until the host closes the pipe.
pub fn run(db_path: &str, days: i64, tz_secs: i64, colour: bool, period_start: Option<i64>) {
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
        if let Some(response) = handle(&msg, db_path, days, tz_secs, colour, period_start) {
            if writeln!(out, "{response}").is_err() {
                break; // stdout closed: host is gone
            }
            out.flush().ok();
        }
    }
}

/// One message in, one response out; `None` for notifications (no `id`).
pub fn handle(
    msg: &Value,
    db_path: &str,
    days: i64,
    tz_secs: i64,
    colour: bool,
    period_start: Option<i64>,
) -> Option<Value> {
    let method = msg.get("method")?.as_str()?;
    let id = msg.get("id")?;
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg
                .pointer("/params/protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "ocuse", "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => tool_call(msg, db_path, days, tz_secs, colour, period_start),
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

fn tool_call(
    msg: &Value,
    db_path: &str,
    days: i64,
    tz_secs: i64,
    colour: bool,
    period_start: Option<i64>,
) -> Result<Value, (i64, String)> {
    let name = msg
        .pointer("/params/name")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let args = msg
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or(json!({}));
    let number =
        |key: &str, fallback: i64| args.get(key).and_then(|v| v.as_i64()).unwrap_or(fallback);

    let rows = || db::read_rows(db_path, crate::ocuse::window::now_ms() - days * 86_400_000);
    let text = match name {
        "usage" => rows().map(|rows| {
            render::render_text(
                &window::build(&rows, &zen::catalog(), window::now_ms(), None),
                db_path,
                15,
                colour,
            )
        }),
        "plans" => Ok(render::plans_text(colour)),
        "daily" => rows().map(|rows| {
            render::bucket_text(
                &rows,
                window::now_ms(),
                number("days", days),
                86_400_000,
                "day",
                tz_secs,
                colour,
            )
        }),
        "hourly" => rows().map(|rows| {
            render::bucket_text(
                &rows,
                window::now_ms(),
                number("hours", 24),
                3_600_000,
                "hour",
                tz_secs,
                colour,
            )
        }),
        "session" => {
            rows().map(|rows| render::session_text(&rows, number("limit", 20) as usize, colour))
        }
        "model" => {
            let wanted = args
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            rows().map(|rows| {
                let report = window::build(&rows, &zen::catalog(), window::now_ms(), period_start);
                render::model_text(&report, &wanted, colour)
            })
        }
        _ => {
            return Ok(json!({
                "content": [{ "type": "text", "text": format!("unknown tool: {name}") }],
                "isError": true,
            }))
        }
    };
    Ok(match text {
        Ok(body) => json!({ "content": [{ "type": "text", "text": body }] }),
        Err(error) => json!({
            "content": [{ "type": "text", "text": format!("error: {error}") }],
            "isError": true,
        }),
    })
}

fn tools() -> Value {
    json!([
        { "name": "usage", "description": "OpenCode Go/Zen usage: period totals, rolling windows, per-model spend against each model's monthly limit.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "plans", "description": "The Go/Zen catalogue from the docs: per-model monthly limits and $/1M rates.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "daily", "description": "Spend, requests and tokens per day.", "inputSchema": { "type": "object", "properties": { "days": { "type": "integer", "description": "days of history (default 120)" } } } },
        { "name": "hourly", "description": "Spend, requests and tokens per hour.", "inputSchema": { "type": "object", "properties": { "hours": { "type": "integer", "description": "hours of history (default 24)" } } } },
        { "name": "session", "description": "Spend per OpenCode session, newest first.", "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer", "description": "sessions to list (default 20)" } } } },
        { "name": "model", "description": "One model's limit, spend and window figures.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "model id, e.g. glm-5.2" } }, "required": ["id"] } },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(method: &str, params: Value, id: i64) -> Value {
        handle(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            "/nonexistent/opencode.db",
            120,
            0,
            false,
            None,
        )
        .expect("notification")
    }

    #[test]
    fn initialize_negotiates_the_client_version() {
        let r = call("initialize", json!({ "protocolVersion": "2025-03-26" }), 1);
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], "ocuse");
    }

    #[test]
    fn unknown_method_is_jsonrpc_error() {
        let r = call("resources/list", json!({}), 2);
        assert_eq!(r["error"]["code"], -32601);
    }

    #[test]
    fn unknown_tool_is_iserror_result_not_rpc_error() {
        let r = call("tools/call", json!({ "name": "nope", "arguments": {} }), 3);
        assert!(r.get("error").is_none());
        assert_eq!(r["result"]["isError"], true);
    }

    #[test]
    fn a_missing_store_reports_an_error_result() {
        let r = call("tools/call", json!({ "name": "usage", "arguments": {} }), 4);
        assert_eq!(r["result"]["isError"], true, "{r}");
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("error"));
    }

    #[test]
    fn tools_list_covers_every_command() {
        let r = call("tools/list", json!({}), 5);
        let names: Vec<&str> = r["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        for expected in ["usage", "plans", "daily", "hourly", "session", "model"] {
            assert!(
                names.contains(&expected),
                "{expected} missing from {names:?}"
            );
        }
    }
}
