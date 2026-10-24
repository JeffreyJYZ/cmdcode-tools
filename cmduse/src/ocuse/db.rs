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
    /// Which local client ran the call — `opencode`, `dsh` or `pi`. The report
    /// names every client it counted, since only opencode's own store was visible
    /// before and a total that silently grew would look like a drift.
    pub client: &'static str,
    pub at_ms: i64,
    pub session: String,
    pub provider: String,
    pub model: String,
    pub cost_usd: f64,
    pub input: u64,
    pub output: u64,
    pub reasoning: u64,
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
    /// Billed at the output rate by opencode itself, so pricing must count it.
    reasoning: Option<u64>,
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

/// opencode's own directory: `$XDG_DATA_HOME/opencode`, else
/// `~/.local/share/opencode`. Holds the store — which carries the Go credential
/// in v2's `credential` table — and `auth.json`, the legacy v1 file.
pub fn opencode_home() -> String {
    let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/.local/share")
    });
    format!("{base}/opencode")
}

/// Default store location: `$OPENCODE_DB`, else the XDG data dir.
pub fn default_path() -> String {
    if let Ok(path) = std::env::var("OPENCODE_DB") {
        return path;
    }
    format!("{}/opencode.db", opencode_home())
}

/// The Go credential opencode itself is using.
///
/// v2 keeps provider credentials in the store's `credential` table; `auth.json`
/// is the legacy v1 file. Reading the file alone produced a dashboard that said
/// `api_key_expired` while Go inference worked: `/connect` had written the
/// replacement key to the store, and the file still held the superseded one.
/// `opencode-go` is the Go subscription and `opencode` is Zen — the same
/// account, and the endpoint answers an entitlement refusal for a Zen key
/// rather than silence, which is more useful than no key at all.
pub fn credential_key() -> Option<String> {
    credential_key_at(&default_path())
}

fn credential_key_at(path: &str) -> Option<String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let mut statement = connection
        .prepare(
            // The boolean ordering puts `opencode-go` ahead of `opencode`, then
            // newest first: a re-connected key supersedes the row it replaced.
            "SELECT value FROM credential WHERE integration_id IN ('opencode-go', 'opencode') \
             ORDER BY (integration_id = 'opencode-go') DESC, time_updated DESC",
        )
        .ok()?;
    let values: Vec<String> = statement
        .query_map([], |row| row.get::<_, String>(0))
        .ok()?
        .flatten()
        .collect();
    drop(statement);
    values
        .iter()
        .filter_map(|value| serde_json::from_str::<Credential>(value).ok())
        .filter_map(|credential| credential.key)
        .find(|key| !key.is_empty())
}

/// `credential.value` is the connector's own JSON — `{"type":"key","key":"…"}`
/// for a pasted API key. Only the key is read; the rest is its business.
#[derive(Deserialize)]
struct Credential {
    key: Option<String>,
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

/// opencode's store plus the other local clients spending the same allowance.
///
/// `pi` and `dsh` keep their own session logs (see [`crate::stores`]), and both
/// run on `opencode-go`, so their calls are the same plan's usage. Only rows on
/// [`PROVIDERS`] are added: a client pointed at some other gateway is not this
/// dashboard's traffic.
pub fn read_all(path: &str, since_ms: i64) -> Result<Vec<Row>, String> {
    let mut rows = read_rows(path, since_ms)?;
    rows.extend(external(&crate::stores::Dirs::from_env(), since_ms));
    Ok(rows)
}

/// Map the extra clients' turns onto this module's rows, dropping any model call
/// that did not run on a Go/Zen provider.
fn external(dirs: &crate::stores::Dirs, since_ms: i64) -> Vec<Row> {
    let catalog = crate::ocuse::zen::catalog();
    crate::stores::read(dirs, since_ms)
        .into_iter()
        .filter(|turn| PROVIDERS.contains(&turn.provider.as_str()))
        .map(|turn| {
            // dsh records no cost of its own, and the daily/hourly/session/model
            // reports sum `cost_usd` rather than pricing — so price it here on the
            // documented schedule, the same fallback `window::build` applies.
            let priced = catalog
                .price(
                    &turn.model,
                    turn.at_ms,
                    turn.input,
                    turn.output,
                    turn.reasoning,
                    turn.cache_read,
                    turn.cache_write,
                )
                .unwrap_or(turn.cost_usd);
            Row {
                client: turn.client,
                at_ms: turn.at_ms,
                session: turn.session,
                provider: turn.provider,
                model: turn.model,
                cost_usd: priced,
                input: turn.input,
                output: turn.output,
                reasoning: turn.reasoning,
                cache_read: turn.cache_read,
                cache_write: turn.cache_write,
            }
        })
        .collect()
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
            client: crate::stores::OPENCODE,
            at_ms,
            session,
            provider,
            model: model.id.unwrap_or_default(),
            cost_usd: parsed.cost.unwrap_or(0.0),
            input: tokens.input.unwrap_or(0),
            output: tokens.output.unwrap_or(0),
            reasoning: tokens.reasoning.unwrap_or(0),
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
            reasoning: None,
            cache: None,
        });
        out.push(Row {
            client: crate::stores::OPENCODE,
            at_ms,
            session,
            provider,
            model: parsed.model.unwrap_or_default(),
            cost_usd: parsed.cost.unwrap_or(0.0),
            input: tokens.input.unwrap_or(0),
            output: tokens.output.unwrap_or(0),
            reasoning: tokens.reasoning.unwrap_or(0),
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
        assert_eq!(rows[0].client, crate::stores::OPENCODE);

        let later = read_rows(&path, 1_500).unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].provider, "opencode");
    }

    /// The extra clients are the same allowance only where the provider says so:
    /// a `pi` session pointed at another gateway is not Go usage.
    #[test]
    fn other_clients_keep_only_go_and_zen_rows() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi/--p--");
        std::fs::create_dir_all(&pi).unwrap();
        std::fs::write(
            pi.join("s.jsonl"),
            concat!(
                r#"{"type":"message","message":{"role":"assistant","provider":"opencode-go","model":"glm-5.2","timestamp":1000,"usage":{"input":10,"output":1}}}"#,
                "\n",
                r#"{"type":"message","message":{"role":"assistant","provider":"openrouter","model":"glm-5.2","timestamp":1000,"usage":{"input":10,"output":1}}}"#,
                "\n",
            ),
        )
        .unwrap();
        let dirs = crate::stores::Dirs {
            dsh: dir.path().join("dsh"),
            pi: dir.path().join("pi"),
        };
        let rows = external(&dirs, 0);
        assert_eq!(rows.len(), 1, "{rows:#?}");
        assert_eq!(rows[0].client, crate::stores::PI);
        assert_eq!(rows[0].provider, "opencode-go");
        assert_eq!(rows[0].input, 10);
    }

    /// v2 holds the live credential; the legacy file is only where a v1 install
    /// kept one — and reading that alone is what reported `api_key_expired` while
    /// Go inference worked.
    #[test]
    fn the_live_credential_comes_from_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE credential (\
                 id TEXT, integration_id TEXT, value TEXT, time_updated INTEGER);",
            )
            .unwrap();
        let insert = |integration: &str, key: &str, at: i64| {
            connection
                .execute(
                    "INSERT INTO credential VALUES (?, ?, ?, ?)",
                    (
                        format!("cred_{at}"),
                        integration,
                        format!(r#"{{"type":"key","key":"{key}"}}"#),
                        at,
                    ),
                )
                .unwrap();
        };
        insert("opencode", "zen", 9_000);
        insert("opencode-go", "go-old", 1_000);
        insert("opencode-go", "go-new", 2_000);
        let path = path.to_string_lossy().into_owned();
        // Go beats Zen and the newest Go row beats the one it replaced, whatever
        // the timestamps say (Zen's is the newest here).
        assert_eq!(credential_key_at(&path).as_deref(), Some("go-new"));

        // An empty key is not a key: nothing to send.
        connection
            .execute(
                "INSERT INTO credential VALUES ('cred_empty', 'opencode-go', '{\"type\":\"key\",\"key\":\"\"}', 3_000)",
                [],
            )
            .unwrap();
        assert_eq!(credential_key_at(&path).as_deref(), Some("go-new"));

        // A store with no such table (v1) reads as "ask the legacy file".
        let legacy = dir.path().join("legacy.db");
        Connection::open(&legacy).unwrap();
        assert!(credential_key_at(&legacy.to_string_lossy()).is_none());
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
