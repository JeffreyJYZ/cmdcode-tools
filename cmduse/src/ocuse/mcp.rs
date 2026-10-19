// MCP stdio server for ocuse — the same JSON-RPC profile cmduse speaks
// (initialize / ping / tools/list / tools/call), so a host that already drives
// cmduse can drive this. Tools mirror the CLI: usage, plans, models, daily,
// hourly, session, model — the same seven cmduse exposes.
//
// Read-only: it reads opencode.db and the generated catalogue. The Go usage
// endpoint's meters are not fetched here — the caller resolves them once (the
// CLI's own rule: one fetch per run, not one per tool call) and hands them in,
// so a `usage` call shows the same window rows the dashboard does.
use crate::ocuse::api::Usage;
use crate::ocuse::{db, render, window, zen};
use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "2025-06-18";

/// What every tool call needs, resolved once by the caller — the per-run
/// settings plus the account meters it already fetched. Bundled rather than
/// passed positionally so adding a source (as `account` did) does not grow every
/// signature in the file.
#[derive(Clone, Copy)]
pub struct Settings<'a> {
    pub db_path: &'a str,
    pub days: i64,
    pub tz_secs: i64,
    pub colour: bool,
    pub plan: &'a str,
    pub period_start: Option<i64>,
    pub account: Option<&'a Usage>,
    /// Why the account's meters are missing, when the CLI resolved it — the same
    /// line the dashboard prints, so a `usage` call through MCP explains itself
    /// too instead of showing bare local estimates.
    pub account_error: Option<&'a str>,
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
            "serverInfo": { "name": "ocuse", "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => tool_call(msg, settings),
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

fn tool_call(msg: &Value, settings: &Settings) -> Result<Value, (i64, String)> {
    let Settings {
        db_path,
        days,
        tz_secs,
        colour,
        plan,
        period_start,
        account,
        account_error,
    } = *settings;
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
    // The plan may be overridden per call; it defaults to the server's flag.
    let plan_id = args
        .get("plan")
        .and_then(|v| v.as_str())
        .unwrap_or(plan)
        .to_string();

    let rows = || db::read_rows(db_path, crate::ocuse::window::now_ms() - days * 86_400_000);
    let text = match name {
        "usage" => rows().map(|rows| {
            let mut report =
                window::build(&rows, &zen::catalog(), &plan_id, window::now_ms(), None);
            // The account's own meters when the caller resolved them, so a `usage`
            // call renders the same window rows the dashboard does — and the same
            // reason when a key was refused.
            report.account = account.cloned();
            report.account_error = account_error.map(str::to_string);
            render::render_text(&report, db_path, 15, colour, render::DEFAULT_BAR_WIDTH)
        }),
        "plans" => Ok(render::plans_text(colour)),
        "models" => {
            // The catalogue is static, but a per-call plan override must be real.
            let catalog = zen::catalog();
            if catalog.plan(&plan_id).is_none() {
                return Err((
                    -32602,
                    format!("plan must be one of: {}", catalog.plan_ids().join(", ")),
                ));
            }
            let gated = args.get("gated").and_then(|v| v.as_bool()).unwrap_or(false);
            Ok(render::models_text(&plan_id, gated, colour))
        }
        "daily" => rows().map(|rows| {
            render::bucket_text(
                &rows,
                window::now_ms(),
                number("days", days) * 86_400_000,
                86_400_000,
                tz_secs,
                colour,
                crate::report_render::Fmt::Table,
            )
        }),
        "hourly" => rows().map(|rows| {
            render::bucket_text(
                &rows,
                window::now_ms(),
                number("hours", 24) * 3_600_000,
                3_600_000,
                tz_secs,
                colour,
                crate::report_render::Fmt::Table,
            )
        }),
        "session" => rows().map(|rows| {
            render::session_text(
                &rows,
                number("limit", 20) as usize,
                colour,
                crate::report_render::Fmt::Table,
            )
        }),
        "model" => {
            let wanted = args
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            rows().map(|rows| {
                let report = window::build(
                    &rows,
                    &zen::catalog(),
                    &plan_id,
                    window::now_ms(),
                    period_start,
                );
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
        { "name": "usage", "description": "OpenCode Go/Zen usage: period totals, rolling windows, per-model spend against each model's monthly limit. Defaults to the Go plan.", "inputSchema": { "type": "object", "properties": { "plan": { "type": "string", "description": "Go plan: go (default) or go-plus" } } } },
        { "name": "plans", "description": "The Go/Zen catalogue from the docs: both Go plans' per-model monthly limits and the shared $/1M rates.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "models", "description": "The Go catalogue for a plan: every model's $/1M in/out/cache-read rates and its monthly limit, marked granted or not.", "inputSchema": { "type": "object", "properties": { "plan": { "type": "string", "description": "Go plan: go (default) or go-plus" }, "gated": { "type": "boolean", "description": "Only models the plan grants" } } } },
        { "name": "daily", "description": "Spend, requests and tokens per day.", "inputSchema": { "type": "object", "properties": { "days": { "type": "integer", "description": "days of history (default 120)" } } } },
        { "name": "hourly", "description": "Spend, requests and tokens per hour.", "inputSchema": { "type": "object", "properties": { "hours": { "type": "integer", "description": "hours of history (default 24)" } } } },
        { "name": "session", "description": "Spend per OpenCode session, newest first.", "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer", "description": "sessions to list (default 20)" } } } },
        { "name": "model", "description": "One model's limit, spend and window figures, against the given Go plan.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "model id, e.g. glm-5.2" }, "plan": { "type": "string", "description": "Go plan: go (default) or go-plus" } }, "required": ["id"] } },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(method: &str, params: Value, id: i64) -> Value {
        handle(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            &Settings {
                db_path: "/nonexistent/opencode.db",
                days: 120,
                tz_secs: 0,
                colour: false,
                plan: crate::ocuse::zen::DEFAULT_PLAN,
                period_start: None,
                // No account: the tests never reach the network, and the local
                // estimate is what the fixtures below are written against.
                account: None,
                account_error: None,
            },
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
        // Sorted set: fails if either MCP server's tool list drifts (the cmduse
        // side asserts the same seven).
        let mut names: Vec<&str> = r["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        names.sort_unstable();
        assert_eq!(
            names,
            ["daily", "hourly", "model", "models", "plans", "session", "usage"]
        );
    }

    #[test]
    fn models_tool_is_the_catalogue_and_needs_no_store() {
        let r = call(
            "tools/call",
            json!({ "name": "models", "arguments": {} }),
            6,
        );
        assert!(r.get("error").is_none(), "{r}");
        let text = r["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("glm-5.3-flash"), "{text}");
        assert!(text.contains("GRANTED"), "{text}");
    }

    #[test]
    fn models_tool_rejects_an_unknown_plan() {
        let r = call(
            "tools/call",
            json!({ "name": "models", "arguments": { "plan": "nope" } }),
            7,
        );
        assert_eq!(r["error"]["code"], -32602, "{r}");
    }
}
