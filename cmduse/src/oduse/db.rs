// The Open Design desktop app's own SQLite store, read-only.
//
// Every assistant message the app completes carries an `events_json` array and
// (via `agent_sessions`) the upstream opencode session that served it. The
// usage record is parsed in `events.rs`; this file owns the SQL and the path.
//
// Read-only by construction (`SQLITE_OPEN_READ_ONLY`), so a running app is
// unaffected: it keeps the database in WAL mode and a reader is allowed
// alongside the writer.
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

pub use super::events::parse_events;

/// Which store a row came from — printed as the report's sources, the way the
/// other binaries name the clients they counted.
pub const APP: &str = "app";
/// `opencode.db` rows: the same plan's turns, run through the agent harness.
pub const OPENCODE: &str = "opencode";

#[derive(Debug, Clone, Default)]
pub struct Row {
    pub at_ms: i64,
    /// The conversation the turn belongs to (the app's session unit).
    pub session: String,
    /// The project the conversation sits in, for the session report.
    pub project: String,
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub duration_ms: Option<u64>,
    /// Where the turn was recorded (see [`APP`] / [`OPENCODE`]).
    pub source: &'static str,
    /// The upstream opencode `ses_…` id, when the store knows it: the desktop app
    /// proxies opencode, so a turn can be visible from both sides. Joining on this
    /// is the only dedupe that is not a guess — tokens are not an identity.
    pub upstream_session: Option<String>,
    /// The client's own dollar figure where it recorded one. opencode writes one,
    /// but it cannot price this provider (1405 of 1419 rows on this machine carry
    /// `cost: 0`), so it is only the fallback for a model the catalogue has never
    /// seen — never the primary figure.
    pub recorded_cost: f64,
}

/// `~/Library/Application Support/Open Design` — the app's data root. macOS-only
/// path, so the env override is the portable half; see [`default_path`].
pub fn store_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    PathBuf::from(home).join("Library/Application Support/Open Design")
}

/// Default store location: `$OD_DB`, else the namespace the app is running —
/// `<root>/namespaces/release-stable/data/app.sqlite`, and when that namespace
/// has no store, the most recently written `namespaces/*/data/app.sqlite`
/// (the directory is version-suffixed and the suffix moves with app releases).
///
/// Returns the canonical `release-stable` path even when nothing exists, so the
/// message a first run prints names the place the app will create.
pub fn default_path() -> String {
    if let Ok(path) = std::env::var("OD_DB") {
        if !path.trim().is_empty() {
            return path;
        }
    }
    let root = store_root();
    let stable_path = root.join("namespaces/release-stable/data/app.sqlite");
    if stable_path.is_file() {
        return stable_path.to_string_lossy().into_owned();
    }
    let canonical = stable_path.to_string_lossy().into_owned();
    newest_store(&root.join("namespaces")).unwrap_or(canonical)
}

/// The most recently modified `*/data/app.sqlite` under `namespaces`, or the
/// canonical path when the directory says nothing.
fn newest_store(namespaces: &Path) -> Option<String> {
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for entry in std::fs::read_dir(namespaces).ok()?.flatten() {
        let candidate = entry.path().join("data/app.sqlite");
        let Ok(meta) = candidate.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        let path = candidate.to_string_lossy().into_owned();
        if best.as_ref().is_none_or(|(best_at, _)| modified > *best_at) {
            best = Some((modified, path));
        }
    }
    best.map(|(_, path)| path)
}

/// Does the app's store carry `agent_sessions` (the proxy's session join)?
fn has_agent_sessions(connection: &Connection) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'",
            [],
            |_| Ok(()),
        )
        .is_ok()
}

/// Every completed assistant turn at or after `since_ms`, oldest first.
///
/// Only assistant rows carry the usage event, so the role filter is the whole
/// selection; the project name falls back to the conversation title (and then to
/// its id) because a draft conversation has no project yet. The upstream session
/// comes from `agent_sessions` when the app recorded one.
pub fn read_rows(path: &str, since_ms: i64) -> Result<Vec<Row>, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open {path}: {e}"))?;
    // `agent_sessions` is how a proxied turn names the opencode session it came
    // from; an app build before that table keeps working, with no dedupe key.
    let upstream = if has_agent_sessions(&connection) {
        "(SELECT s.session_id FROM agent_sessions s \
         WHERE s.conversation_id = m.conversation_id ORDER BY s.updated_at DESC LIMIT 1)"
    } else {
        "NULL"
    };
    let sql = format!(
        "SELECT m.created_at, m.conversation_id, \
                COALESCE(p.name, c.title, m.conversation_id), m.events_json, {upstream} \
         FROM messages m \
         LEFT JOIN conversations c ON c.id = m.conversation_id \
         LEFT JOIN projects p ON p.id = c.project_id \
         WHERE m.role = 'assistant' AND m.created_at >= ? \
         ORDER BY m.created_at"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|e| format!("prepare: {e}"))?;
    let mut rows = statement
        .query([since_ms])
        .map_err(|e| format!("query: {e}"))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("row: {e}"))? {
        let at_ms: i64 = row.get(0).map_err(|e| format!("created_at: {e}"))?;
        let session: String = row.get(1).unwrap_or_default();
        let project: String = row.get(2).unwrap_or_default();
        let events: String = row.get(3).unwrap_or_default();
        let upstream_session: Option<String> = row.get(4).ok().filter(|s: &String| !s.is_empty());
        let Some(turn) = parse_events(&events) else {
            continue; // no usage event: still streaming, or the turn failed
        };
        out.push(Row {
            at_ms,
            session,
            project,
            model: turn.model,
            input: turn.input,
            output: turn.output,
            cache_read: 0,
            cache_write: 0,
            duration_ms: turn.duration_ms,
            source: APP,
            upstream_session,
            recorded_cost: 0.0,
        });
    }
    Ok(out)
}
