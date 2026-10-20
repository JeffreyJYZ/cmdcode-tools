// Protocol-level tests for the MCP server: pure dispatch over `handle()`.
// Tool bodies (usage/plans/models/daily/hourly/session/model) are the shared
// CLI helpers and are covered by the CLI tests; here we pin the JSON-RPC
// contract.

use crate::mcp::handle;
use serde_json::{json, Value};

fn call(method: &str, params: Value, id: i64) -> Value {
    handle(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
        .expect("request must get a response")
}

/// One tool's argument names, sorted and space-joined: exact, and readable when
/// it fails. Shared with `ocuse`'s and `arkuse`'s schema tests, so a drift on one
/// server fails all three suites instead of passing silently on the other two.
pub(crate) fn tool_params(tools: &Value, name: &str) -> String {
    let tool = tools
        .as_array()
        .expect("tools array")
        .iter()
        .find(|t| t["name"] == name)
        .unwrap_or_else(|| panic!("no {name} tool"));
    let mut keys: Vec<&str> = tool["inputSchema"]["properties"]
        .as_object()
        .map(|m| m.keys().map(String::as_str).collect())
        .unwrap_or_default();
    keys.sort_unstable();
    keys.join(" ")
}

#[test]
fn notification_gets_no_response() {
    // no "id" → notification → None (e.g. notifications/initialized)
    let msg = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    assert!(handle(&msg).is_none());
}

#[test]
fn non_jsonrpc_message_gets_no_response() {
    assert!(handle(&json!({ "foo": 1 })).is_none());
}

#[test]
fn initialize_echoes_client_protocol_version() {
    let r = call(
        "initialize",
        json!({ "protocolVersion": "2025-03-26", "clientInfo": { "name": "zed" } }),
        1,
    );
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(r["result"]["serverInfo"]["name"], "cmduse");
    assert_eq!(r["result"]["capabilities"]["tools"], json!({}));
}

#[test]
fn initialize_without_client_version_uses_latest() {
    let r = call("initialize", json!({}), 2);
    assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
}

#[test]
fn ping_returns_empty_result() {
    let r = call("ping", json!({}), 3);
    assert_eq!(r["result"], json!({}));
}

#[test]
fn tools_list_exposes_seven_tools() {
    let r = call("tools/list", json!({}), 4);
    let tools = r["result"]["tools"].as_array().expect("tools array");
    // Sorted set: fails if either MCP server's tool list drifts.
    let mut names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        ["daily", "hourly", "model", "models", "plans", "session", "usage"]
    );
    for t in tools {
        assert_eq!(t["inputSchema"]["type"], "object");
    }
}

/// The *arguments* each tool takes, not just its name: the seven names were
/// pinned from the start while the arguments drifted, so `models` could not gate
/// and `session`/`model` could not be windowed on this server but could on the
/// other two.
#[test]
fn tool_arguments_are_the_family_surface() {
    let r = call("tools/list", json!({}), 40);
    let tools = &r["result"]["tools"];
    let params = |name: &str| crate::mcp_tests::tool_params(tools, name);
    assert_eq!(params("usage"), "");
    assert_eq!(params("plans"), "");
    assert_eq!(params("models"), "gated");
    assert_eq!(params("daily"), "days local tz");
    assert_eq!(params("hourly"), "hours local tz");
    assert_eq!(params("session"), "days rows since tz");
    assert_eq!(params("model"), "days id rows since tz");
}

#[test]
fn unknown_method_is_jsonrpc_error() {
    let r = call("resources/list", json!({}), 5);
    assert_eq!(r["error"]["code"], -32601);
}

#[test]
fn unknown_tool_is_iserror_result_not_rpc_error() {
    let r = call("tools/call", json!({ "name": "nope", "arguments": {} }), 6);
    assert!(r.get("error").is_none());
    assert_eq!(r["result"]["isError"], true);
}

#[test]
fn bad_tz_argument_is_invalid_params_error() {
    let r = call(
        "tools/call",
        json!({ "name": "daily", "arguments": { "tz": "mars" } }),
        7,
    );
    assert_eq!(r["error"]["code"], -32602);
}

#[test]
fn result_envelope_carries_request_id() {
    let r = call("tools/list", json!({}), 99);
    assert_eq!(r["id"], 99);
    assert_eq!(r["jsonrpc"], "2.0");
}
