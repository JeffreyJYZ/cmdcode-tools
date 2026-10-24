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
    // `--tz` per call: the bucket offset is the one thing a caller routinely
    // wants different from the server's flag.
    let tz = match args.get("tz").and_then(|v| v.as_str()) {
        None => tz_secs,
        Some(s) => crate::cli::parse_tz(s).ok_or((
            -32602,
            "tz needs an offset like +05:30 or -08:00".to_string(),
        ))?,
    };
    // Rows to list: `rows` (the CLI flag's name), `limit` still accepted because
    // it shipped first, and the server returns every row when neither is given.
    let rows_cap = |fallback: usize| -> usize {
        match args
            .get("rows")
            .or_else(|| args.get("limit"))
            .and_then(|v| v.as_u64())
        {
            Some(0) | None => fallback,
            Some(n) => n as usize,
        }
    };
    // `since` pins the read window exactly, as in the CLI.
    let since_ms = match args.get("since").and_then(|v| v.as_str()) {
        None => None,
        Some(s) => Some(cmduse_core::dates::parse_iso_utc(s).ok_or((
            -32602,
            format!("since needs an ISO-8601 instant, got '{s}'"),
        ))? as i64),
    };
    // The plan may be overridden per call; it defaults to the server's flag.
    let plan_id = args
        .get("plan")
        .and_then(|v| v.as_str())
        .unwrap_or(plan)
        .to_string();

    let rows = || {
        let cutoff = since_ms
            .unwrap_or_else(|| crate::ocuse::window::now_ms() - number("days", days) * 86_400_000);
        db::read_all(db_path, cutoff)
    };
    let text = match name {
        "usage" => rows().map(|rows| {
            let mut report = window::build(
                &rows,
                &zen::catalog(),
                &plan_id,
                window::now_ms(),
                None,
                account,
            );
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
                tz,
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
                tz,
                colour,
                crate::report_render::Fmt::Table,
            )
        }),
        "session" => rows().map(|rows| {
            render::session_text(
                &rows,
                rows_cap(usize::MAX),
                colour,
                crate::report_render::Fmt::Table,
            )
        }),
        "model" => rows().map(|rows| {
            let report = window::build(
                &rows,
                &zen::catalog(),
                &plan_id,
                window::now_ms(),
                period_start,
                account,
            );
            match args.get("id").and_then(|v| v.as_str()) {
                Some(wanted) => render::model_text(&report, wanted, colour),
                None => render::render_text(
                    &report,
                    db_path,
                    rows_cap(usize::MAX),
                    colour,
                    render::DEFAULT_BAR_WIDTH,
                ),
            }
        }),
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
        { "name": "daily", "description": "Spend, requests and tokens per day.", "inputSchema": { "type": "object", "properties": { "days": { "type": "integer", "description": "days of history (default 120)" }, "tz": { "type": "string", "description": "UTC offset for the day buckets, e.g. +05:30" } } } },
        { "name": "hourly", "description": "Spend, requests and tokens per hour.", "inputSchema": { "type": "object", "properties": { "hours": { "type": "integer", "description": "hours of history (default 24)" }, "tz": { "type": "string", "description": "UTC offset for the hour buckets, e.g. -08:00" } } } },
        { "name": "session", "description": "Spend per OpenCode session, newest first.", "inputSchema": { "type": "object", "properties": { "since": { "type": "string", "description": "ISO-8601 instant to count from, e.g. 2026-08-27T00:00:00Z" }, "days": { "type": "integer", "description": "days back (used when since is absent)" }, "rows": { "type": "integer", "description": "sessions to list (0 = every row)" } } } },
        { "name": "model", "description": "One model's limit, spend and window figures against the given Go plan; without id, the whole period table.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "model id, e.g. glm-5.2 (omit for the table)" }, "plan": { "type": "string", "description": "Go plan: go (default) or go-plus" }, "since": { "type": "string", "description": "ISO-8601 instant to count from" }, "days": { "type": "integer", "description": "days back (used when since is absent)" }, "rows": { "type": "integer", "description": "table rows to list (0 = every row)" } } } },
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
    fn tool_arguments_are_the_family_surface() {
        let r = call("tools/list", json!({}), 40);
        let tools = &r["result"]["tools"];
        let params = |name: &str| crate::mcp_tests::tool_params(tools, name);
        // The Go source forces `plan` on the tools that read the catalogue; the
        // rest is the family surface both other servers carry.
        assert_eq!(params("usage"), "plan");
        assert_eq!(params("plans"), "");
        assert_eq!(params("models"), "gated plan");
        assert_eq!(params("daily"), "days tz");
        assert_eq!(params("hourly"), "hours tz");
        assert_eq!(params("session"), "days rows since");
        assert_eq!(params("model"), "days id plan rows since");
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
