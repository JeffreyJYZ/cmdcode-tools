// opencode's own message store, read-only.
//
// Every assistant row opencode writes carries a provider, model and `tokens`,
// plus a timestamp — a complete, backfilled per-request record for everything
// the agent ran on this machine. ARK's plan has its own currency (AFP) and
// opencode cannot price it, so only the tokens are used; the coefficient table
// in `core/ark.json` turns those into AFP.
//
// Two layouts: v1 `message` keeps them flat (`role` / `modelID` / `providerID`),
// v2 `session_message` puts the role in the row's `type` and nests the model
// (`model.id` / `model.providerID`). v2 stopped appending to `message` at the
// migration, so reading only the legacy table reports zero for every recent
// session; `read_rows` picks by table and keeps `message` as the fallback.
//
// Only `provider = "agent-plan"` rows are plan usage. `opencode-go/*` and
// `opencode/*` rows are other services and are excluded here, never added to
// AFP — they may appear in the same store.
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
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

#[derive(Deserialize)]
struct V2AssistantData {
    model: Option<V2Model>,
    tokens: Option<Tokens>,
}

#[derive(Deserialize)]
struct V2Model {
    id: Option<String>,
    #[serde(rename = "providerID")]
    provider: Option<String>,
}

#[derive(Deserialize)]
struct AssistantData {
    role: Option<String>,
    #[serde(rename = "providerID")]
    provider: Option<String>,
    #[serde(rename = "modelID")]
    model: Option<String>,
    tokens: Option<Tokens>,
}

/// `reasoning` is inside `output` in opencode's own accounting (the docs say so,
/// and the store's `cost` bills it at the output rate), so it is not added
/// again here — counting it twice would inflate AFP.
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

/// The only provider that consumes this plan. `agent-plan` is what opencode
/// writes for ARK's plan base URL.
pub const PROVIDERS: [&str; 1] = ["agent-plan"];

/// opencode's data directory: `$XDG_DATA_HOME/opencode`, else the platform
/// default.
pub fn opencode_home() -> String {
    if let Ok(dir) = std::env::var("XDG_DATA_HOME") {
        if !dir.is_empty() {
            return format!("{dir}/opencode");
        }
    }
    crate::paths::home()
        .join(".local/share/opencode")
        .display()
        .to_string()
}

/// `$OPENCODE_DB`, else the store under [`opencode_home`].
pub fn default_path() -> String {
    if let Ok(path) = std::env::var("OPENCODE_DB") {
        if !path.is_empty() {
            return path;
        }
    }
    format!("{}/opencode.db", opencode_home())
}

/// Read every assistant row the plan billed, at or after `since_ms`.
///
/// The table picked here is the difference between a real figure and a silent
/// zero: v2 stopped appending to `message` at the migration, and every report
/// was zero until this branch existed. `time_created >= ?` keeps either scan
/// bounded; rows are filtered by provider in Rust because the JSON payload is
/// not indexed.
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
        let model = parsed.model.unwrap_or(V2Model {
            id: None,
            provider: None,
        });
        let provider = model.provider.unwrap_or_default();
        if !PROVIDERS.contains(&provider.as_str()) {
            continue;
        }
        out.push(Row {
            at_ms,
            session,
            provider,
            model: model.id.unwrap_or_default(),
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
            r#"{"model":{"id":"deepseek-v4.1-flash","providerID":"agent-plan"},"tokens":{"input":10,"output":2,"cache":{"read":7,"write":0}}}"#,
            1_000,
        );
        insert(
            "assistant",
            r#"{"model":{"id":"gpt-5.5","providerID":"opencode-go"},"tokens":{"input":1,"output":1}}"#,
            2_000,
        );
        // In-flight: a model ref but no tokens yet.
        insert(
            "assistant",
            r#"{"model":{"id":"deepseek-v4.1-flash","providerID":"agent-plan"}}"#,
            3_000,
        );
        // The role lives in `type`, so this user row must not count.
        insert("user", r#"{"text":"hi"}"#, 4_000);
        (dir, path.to_string_lossy().into_owned())
    }

    #[test]
    fn reads_only_plan_assistant_rows_in_window() {
        let (_dir, path) = v2_fixture();
        let rows = read_rows(&path, 0).unwrap();
        assert_eq!(rows.len(), 1, "{rows:#?}");
        assert_eq!(rows[0].provider, "agent-plan");
        assert_eq!(rows[0].model, "deepseek-v4.1-flash");
        assert_eq!(rows[0].cache_read, 7);

        let later = read_rows(&path, 1_500).unwrap();
        assert!(later.is_empty(), "the only plan row is at 1s");
    }

    #[test]
    fn missing_database_is_an_error_not_a_panic() {
        let error = read_rows("/nonexistent/opencode.db", 0).unwrap_err();
        assert!(error.contains("open"), "{error}");
    }
}
