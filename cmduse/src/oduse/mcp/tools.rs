// The seven tool schemas. Kept in their own file because the schema block is
// long and says nothing about the protocol, and because the argument sets are the
// contract `tests/mcp.rs` pins.
//
// Every tool carries the same names as the other three servers. `plan` is on the
// three that read the catalogue (nothing reports a tier); `models` has no `gated`
// because OpenDesign prices models differently rather than restricting them.
use serde_json::{json, Value};

pub fn tools() -> Value {
    json!([
        { "name": "usage", "description": "OpenDesign usage: period credits, the plan's windows, the wallet balance when the desktop app is running, and per-model spend. Defaults to the Go plan.", "inputSchema": { "type": "object", "properties": { "plan": { "type": "string", "description": "plan: go (default), plus, pro or max" } } } },
        { "name": "plans", "description": "The OpenDesign catalogue: every plan's price, caps and concurrency, then the per-model multipliers and $/1M rates with their provenance.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "models", "description": "Every model's credit multiplier and $/1M in/out rates, with the selected plan's caps. There is no gated view: a plan prices models differently, it does not restrict them.", "inputSchema": { "type": "object", "properties": { "plan": { "type": "string", "description": "plan: go (default), plus, pro or max" } } } },
        { "name": "daily", "description": "Credits, requests and tokens per day.", "inputSchema": { "type": "object", "properties": { "days": { "type": "integer", "description": "days of history (default 120)" }, "tz": { "type": "string", "description": "UTC offset for the day buckets, e.g. +05:30" } } } },
        { "name": "hourly", "description": "Credits, requests and tokens per hour.", "inputSchema": { "type": "object", "properties": { "hours": { "type": "integer", "description": "hours of history (default 24)" }, "tz": { "type": "string", "description": "UTC offset for the hour buckets, e.g. -08:00" } } } },
        { "name": "session", "description": "Credits per OpenDesign conversation, newest first.", "inputSchema": { "type": "object", "properties": { "since": { "type": "string", "description": "ISO-8601 instant to count from, e.g. 2026-08-27T00:00:00Z" }, "days": { "type": "integer", "description": "days back (used when since is absent)" }, "rows": { "type": "integer", "description": "sessions to list (0 = every row)" } } } },
        { "name": "model", "description": "One model's credits and window figures against the given plan; without id, the whole period table.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "model id, e.g. deepseek-v4.1-flash (omit for the table)" }, "plan": { "type": "string", "description": "plan: go (default), plus, pro or max" }, "since": { "type": "string", "description": "ISO-8601 instant to count from" }, "days": { "type": "integer", "description": "days back (used when since is absent)" }, "rows": { "type": "integer", "description": "table rows to list (0 = every row)" } } } },
    ])
}
