// opencode's own message store, read-only.
//
// Every assistant row opencode writes carries a provider, model, `cost` and
// `tokens`, plus a timestamp — a complete, backfilled per-request record for
// everything the agent ran on this machine. Unlike CommandCode (subscription,
// cost 0), opencode-go rows carry real cost, so this is also the spend figure.
//
// Two layouts: v1 `message` keeps them flat (`role` / `modelID` / `providerID`),
// v2 `session_message` puts the role in the row's `type` and nests the model
// (`model.id` / `model.providerID`). v2 stopped appending to `message` at the
// migration, so reading only the legacy table reports zero for every recent
// session; `read_rows` picks by table and keeps `message` as the fallback.
//
// Read-only by construction: `OpenFlags::SQLITE_OPEN_READ_ONLY`, so a running
// opencode is unaffected.
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;

#[derive(Debug, Clone, Default)]
pub struct Row {
    pub at_ms: i64,
    pub session: String,
    pub provider: String,
    pub model: String,
    pub cost_usd: f64,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

#[derive(Deserialize)]
struct AssistantData {
    role: Option<String>,
    #[serde(rename = "providerID")]
    provider: Option<String>,
    #[serde(rename = "modelID")]
    model: Option<String>,
    cost: Option<f64>,
    tokens: Option<Tokens>,
}

/// v2 keeps the role in `session_message.type` (the row selector, so it is not
/// in the payload) and nests the model ref: `model.id` / `model.providerID`.
#[derive(Deserialize, Default)]
struct V2AssistantData {
    model: Option<V2Model>,
    cost: Option<f64>,
    tokens: Option<Tokens>,
}

#[derive(Deserialize, Default)]
struct V2Model {
    id: Option<String>,
    #[serde(rename = "providerID")]
    provider: Option<String>,
}

#[derive(Deserialize)]
struct Tokens {
    input: Option<u64>,
    output: Option<u64>,
    cache: Option<Cache>,
}

#[derive(Deserialize)]
struct Cache {
    read: Option<u64>,
    write: Option<u64>,
}

/// Providers that belong to this tool. `opencode-go` is the Go subscription,
/// `opencode` the Zen pay-as-you-go gateway.
pub const PROVIDERS: [&str; 2] = ["opencode-go", "opencode"];

/// Default store location: `$OPENCODE_DB`, else the XDG data dir.
pub fn default_path() -> String {
    if let Ok(path) = std::env::var("OPENCODE_DB") {
        return path;
    }
    let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/.local/share")
    });
    format!("{base}/opencode/opencode.db")
}

/// Every OpenCode-owned assistant row at or after `since_ms`, oldest first.
///
/// Reads v2's `session_message` when the store has it, and the legacy `message`
/// table otherwise, so an upgraded opencode does not read as "no usage" — v2
/// stopped appending to `message` at the migration, and every report was zero
/// until this branch existed. `time_created >= ?` keeps either scan bounded;
/// rows are filtered by provider in Rust because the JSON payload is not
/// indexed.
pub fn read_rows(path: &str, since_ms: i64) -> Result<Vec<Row>, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open {path}: {e}"))?;
    if has_v2(&connection) {
        read_v2(&connection, since_ms)
    } else {
        read_legacy(&connection, since_ms)
    }
}

/// Does this store use opencode v2's `session_message` table?
fn has_v2(connection: &Connection) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_message'",
            [],
            |_| Ok(()),
        )
        .is_ok()
}

/// v2 rows: the row's `type` names it (no `$.role`), the model ref is nested,
/// and only a completed turn carries `tokens` — an in-flight one is skipped
/// rather than counted as a zero-token request.
fn read_v2(connection: &Connection, since_ms: i64) -> Result<Vec<Row>, String> {
    let mut statement = connection
        .prepare(
            "SELECT data, time_created, session_id FROM session_message
             WHERE type = 'assistant' AND time_created >= ?",
        )
        .map_err(|e| format!("prepare: {e}"))?;
    let mut rows = statement
        .query([since_ms])
        .map_err(|e| format!("query: {e}"))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("row: {e}"))? {
        let data: String = row.get(0).map_err(|e| format!("data: {e}"))?;
        let at_ms: i64 = row.get(1).map_err(|e| format!("time: {e}"))?;
        let session: String = row.get(2).unwrap_or_default();
        let Ok(parsed) = serde_json::from_str::<V2AssistantData>(&data) else {
            continue;
        };
        let Some(tokens) = parsed.tokens else {
            continue; // still streaming: not billed yet
        };
        let model = parsed.model.unwrap_or_default();
        let provider = model.provider.unwrap_or_default();
        if !PROVIDERS.contains(&provider.as_str()) {
            continue;
        }
        out.push(Row {
            at_ms,
            session,
            provider,
            model: model.id.unwrap_or_default(),
            cost_usd: parsed.cost.unwrap_or(0.0),
            input: tokens.input.unwrap_or(0),
            output: tokens.output.unwrap_or(0),
            cache_read: tokens.cache.as_ref().and_then(|c| c.read).unwrap_or(0),
            cache_write: tokens.cache.and_then(|c| c.write).unwrap_or(0),
        });
    }
    Ok(out)
}

/// Pre-v2 rows: `role` in the payload, flat `modelID` / `providerID`.
fn read_legacy(connection: &Connection, since_ms: i64) -> Result<Vec<Row>, String> {
    let mut statement = connection
        .prepare(
            "SELECT data, time_created, session_id FROM message
             WHERE data LIKE '%\"tokens\"%' AND time_created >= ?",
        )
        .map_err(|e| format!("prepare: {e}"))?;
    let mut rows = statement
        .query([since_ms])
        .map_err(|e| format!("query: {e}"))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("row: {e}"))? {
        let data: String = row.get(0).map_err(|e| format!("data: {e}"))?;
        let at_ms: i64 = row.get(1).map_err(|e| format!("time: {e}"))?;
        let session: String = row.get(2).unwrap_or_default();
        let Ok(parsed) = serde_json::from_str::<AssistantData>(&data) else {
            continue;
        };
        if parsed.role.as_deref() != Some("assistant") {
            continue;
        }
        let provider = parsed.provider.unwrap_or_default();
        if !PROVIDERS.contains(&provider.as_str()) {
            continue;
        }
        let tokens = parsed.tokens.unwrap_or(Tokens {
            input: None,
            output: None,
            cache: None,
        });
        out.push(Row {
            at_ms,
            session,
            provider,
            model: parsed.model.unwrap_or_default(),
            cost_usd: parsed.cost.unwrap_or(0.0),
            input: tokens.input.unwrap_or(0),
            output: tokens.output.unwrap_or(0),
            cache_read: tokens.cache.as_ref().and_then(|c| c.read).unwrap_or(0),
            cache_write: tokens.cache.and_then(|c| c.write).unwrap_or(0),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A miniature store, shaped like the real one.
    fn fixture() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE message (session_id TEXT, data TEXT, time_created INTEGER);",
            )
            .unwrap();
        let insert = |data: &str, at: i64| {
            connection
                .execute(
                    "INSERT INTO message VALUES ('ses_fixture', ?, ?)",
                    (data, at),
                )
                .unwrap();
        };
        insert(
            r#"{"role":"assistant","providerID":"opencode-go","modelID":"glm-5.3-flash","cost":0.5,"tokens":{"input":10,"output":2,"cache":{"read":7,"write":0}}}"#,
            1_000,
        );
        insert(
            r#"{"role":"assistant","providerID":"opencode","modelID":"gpt-5.5","cost":1.25,"tokens":{"input":1,"output":1}}"#,
            2_000,
        );
        insert(
            r#"{"role":"user","providerID":"opencode-go","tokens":{"input":1}}"#,
            3_000,
        );
        insert(
            r#"{"role":"assistant","providerID":"command-code-openai","modelID":"deepseek-v4.1-flash","cost":9.0,"tokens":{"input":1}}"#,
            4_000,
        );
        (dir, path.to_string_lossy().into_owned())
    }

    #[test]
    fn reads_only_opencode_assistant_rows_in_window() {
        let (_dir, path) = fixture();
        let rows = read_rows(&path, 0).unwrap();
        assert_eq!(rows.len(), 2, "{rows:#?}");
        assert_eq!(rows[0].provider, "opencode-go");
        assert_eq!(rows[0].cache_read, 7);
        assert!((rows[0].cost_usd - 0.5).abs() < f64::EPSILON);
        assert_eq!(rows[1].model, "gpt-5.5");

        let later = read_rows(&path, 1_500).unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].provider, "opencode");
    }

    /// A v2 store: `session_message`, role in `type`, model ref nested.
    fn v2_fixture() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE session_message (\
                 id TEXT, session_id TEXT, type TEXT, seq INTEGER, \
                 time_created INTEGER, time_updated INTEGER, data TEXT);",
            )
            .unwrap();
        let insert = |kind: &str, data: &str, at: i64| {
            connection
                .execute(
                    "INSERT INTO session_message \
                     (id, session_id, type, seq, time_created, time_updated, data) \
                     VALUES (?, 'ses_v2', ?, 0, ?, ?, ?)",
                    (format!("msg_{at}"), kind, at, at, data),
                )
                .unwrap();
        };
        insert(
            "assistant",
            r#"{"model":{"id":"glm-5.3-flash","providerID":"opencode-go"},"cost":0.5,"tokens":{"input":10,"output":2,"cache":{"read":7,"write":0}}}"#,
            1_000,
        );
        insert(
            "assistant",
            r#"{"model":{"id":"gpt-5.5","providerID":"opencode"},"cost":1.25,"tokens":{"input":1,"output":1}}"#,
            2_000,
        );
        // In-flight: a model ref but no tokens yet.
        insert(
            "assistant",
            r#"{"model":{"id":"gpt-5.5","providerID":"opencode"}}"#,
            3_000,
        );
        // The role lives in `type`, so this user row must not count.
        insert("user", r#"{"text":"hi"}"#, 4_000);
        insert(
            "assistant",
            r#"{"model":{"id":"deepseek","providerID":"command-code-openai"},"cost":9.0,"tokens":{"input":1}}"#,
            5_000,
        );
        (dir, path.to_string_lossy().into_owned())
    }

    #[test]
    fn reads_v2_rows_skipping_inflight_and_foreign_providers() {
        let (_dir, path) = v2_fixture();
        let rows = read_rows(&path, 0).unwrap();
        assert_eq!(rows.len(), 2, "{rows:#?}");
        assert_eq!(rows[0].provider, "opencode-go");
        assert_eq!(rows[0].model, "glm-5.3-flash");
        assert_eq!(rows[0].cache_read, 7);
        assert!((rows[0].cost_usd - 0.5).abs() < f64::EPSILON);
        assert_eq!(rows[1].model, "gpt-5.5");

        let later = read_rows(&path, 1_500).unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].provider, "opencode");
    }

    #[test]
    fn missing_database_is_an_error_not_a_panic() {
        let error = read_rows("/nonexistent/opencode.db", 0).unwrap_err();
        assert!(error.contains("open"), "{error}");
    }
}
