// The MCP server: the same seven tools, each with this source's arguments.
use crate::oduse::mcp::{handle, Settings};
use crate::oduse::od;
use serde_json::{json, Value};

fn call(method: &str, params: Value, id: i64) -> Value {
    handle(
        &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        &Settings {
            db_path: "/nonexistent/app.sqlite",
            opencode_path: "/nonexistent/opencode.db",
            days: 120,
            tz_secs: 0,
            colour: false,
            plan: od::DEFAULT_PLAN,
            period_start: None,
            // No wallet: the tests never reach a listening daemon, and the local
            // estimate is what the fixtures are written against.
            wallet: None,
            wallet_error: Some("daemon not running"),
            wallet_source: None,
        },
    )
    .expect("notification")
}

#[test]
fn initialize_negotiates_the_client_version() {
    let r = call("initialize", json!({ "protocolVersion": "2025-03-26" }), 1);
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(r["result"]["serverInfo"]["name"], "oduse");
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
    // The source forces `plan` on the tools that read the catalogue and forbids
    // `gated`: OpenDesign prices models per plan, it does not restrict them.
    assert_eq!(params("usage"), "plan");
    assert_eq!(params("plans"), "");
    assert_eq!(params("models"), "plan");
    assert_eq!(params("daily"), "days tz");
    assert_eq!(params("hourly"), "hours tz");
    assert_eq!(params("session"), "days rows since");
    assert_eq!(params("model"), "days id plan rows since");
}

#[test]
fn models_is_the_catalogue_and_needs_no_store() {
    let r = call(
        "tools/call",
        json!({ "name": "models", "arguments": {} }),
        6,
    );
    assert!(r.get("error").is_none(), "{r}");
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("deepseek-v4.1-flash"), "{text}");
    assert!(text.contains("MULT"), "{text}");
}

#[test]
fn an_unknown_plan_is_invalid_params() {
    let r = call(
        "tools/call",
        json!({ "name": "usage", "arguments": { "plan": "nope" } }),
        7,
    );
    assert_eq!(r["error"]["code"], -32602, "{r}");
    assert!(r["error"]["message"].as_str().unwrap().contains("go"));
}

#[test]
fn a_bad_tz_is_invalid_params() {
    let r = call(
        "tools/call",
        json!({ "name": "daily", "arguments": { "tz": "mars" } }),
        8,
    );
    assert_eq!(r["error"]["code"], -32602);
}
