// The Open Design desktop app's own SQLite store, read-only.
//
// Every assistant message the app completes carries an `events_json` array, and
// two of its events are the whole usage record:
//
//   {"kind":"status","label":"model","detail":"<model id>"}
//   {"kind":"usage","inputTokens":N,"outputTokens":N,"durationMs":N}
//
// There is no cost and no cache counter — the app bills against a plan, not per
// token — so `oduse` prices each turn itself from `core/od.json` and calls the
// result an estimate. A message without a `usage` event is a turn that is still
// streaming or failed, and is skipped rather than counted as zero.
//
// Read-only by construction (`SQLITE_OPEN_READ_ONLY`), so a running app is
// unaffected: it keeps the database in WAL mode and a reader is allowed
// alongside the writer.
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

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
    pub duration_ms: Option<u64>,
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
/// error a first run prints names the place the app will create.
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

/// Every completed assistant turn at or after `since_ms`, oldest first.
///
/// Only assistant rows carry the usage event, so the role filter is the whole
/// selection; the project name falls back to the conversation title (and then to
/// its id) because a draft conversation has no project yet.
pub fn read_rows(path: &str, since_ms: i64) -> Result<Vec<Row>, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open {path}: {e}"))?;
    let mut statement = connection
        .prepare(
            "SELECT m.created_at, m.conversation_id, \
                    COALESCE(p.name, c.title, m.conversation_id), m.events_json \
             FROM messages m \
             LEFT JOIN conversations c ON c.id = m.conversation_id \
             LEFT JOIN projects p ON p.id = c.project_id \
             WHERE m.role = 'assistant' AND m.created_at >= ? \
             ORDER BY m.created_at",
        )
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
            duration_ms: turn.duration_ms,
        });
    }
    Ok(out)
}

/// One message's two interesting events, extracted from its `events_json`.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub duration_ms: Option<u64>,
}

/// Parse `events_json`. `None` when the array carries no `usage` event — the
/// only signal that the turn actually completed and spent tokens.
pub fn parse_events(events_json: &str) -> Option<Turn> {
    let events: Vec<serde_json::Value> = serde_json::from_str(events_json).ok()?;
    let mut model = String::new();
    let mut usage: Option<(u64, u64, Option<u64>)> = None;
    for event in &events {
        match event.get("kind").and_then(|k| k.as_str()) {
            Some("status") => {
                // Only the status whose label is `model` names the model; the
                // others are `starting` and transport chatter.
                if event.get("label").and_then(|l| l.as_str()) == Some("model") {
                    if let Some(detail) = event.get("detail").and_then(|d| d.as_str()) {
                        model = detail.to_string();
                    }
                }
            }
            Some("usage") => {
                let number = |key: &str| event.get(key).and_then(|v| v.as_u64());
                usage = Some((
                    number("inputTokens").unwrap_or(0),
                    number("outputTokens").unwrap_or(0),
                    number("durationMs"),
                ));
            }
            _ => {}
        }
    }
    let (input, output, duration_ms) = usage?;
    Some(Turn {
        model,
        input,
        output,
        duration_ms,
    })
}
