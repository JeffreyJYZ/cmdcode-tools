// Both stores, read as one source set.
//
// The plan is spent wherever its models run: the desktop app's own store (proxied
// opencode turns included) and `opencode.db` under providers `open-design*`. Either
// may be absent — a machine that only uses one is normal — so a missing store
// contributes nothing and states one line about why, never an error.
//
// Dedupe is on the upstream session id, the only identity the two stores share:
// the app proxies opencode (`agent_sessions.session_id` is a `ses_…` id), so a
// proxied turn can be visible from both sides. opencode's copy carries the cache
// counters, so it wins; the app's row for a session opencode holds is dropped.
// Never dedupe on token counts — two different turns can match by accident.
use crate::oduse::db::{self, Row};
use crate::oduse::opencode;

/// What a read found: the rows, the sources that contributed them, and one line
/// per store that could not be read.
#[derive(Debug, Default)]
pub struct Sources {
    pub rows: Vec<Row>,
    /// `app` and/or `opencode`, in the order they were read.
    pub names: Vec<&'static str>,
    /// One line per absent or unreadable store, for the report's footnote.
    pub notes: Vec<String>,
}

impl Sources {
    /// `true` when every store was absent: the report then says "no store" rather
    /// than "no completed turns", which are different problems.
    pub fn empty(&self) -> bool {
        self.names.is_empty()
    }
}

/// Read both stores at or after `since_ms`, oldest first.
///
/// `app_path` is the desktop store (`--db` / `$OD_DB`) and `opencode_path` the
/// harness one (`--opencode-db` / `$OD_OPENCODE_DB`). The app store is required
/// by the CLI (it exits with a hint when it cannot be read) while opencode's is
/// optional, so a failure there is a note rather than an exit.
pub fn read(app_path: &str, opencode_path: &str, since_ms: i64) -> Result<Sources, String> {
    let mut sources = Sources::default();
    let app = db::read_rows(app_path, since_ms)?;
    // A store that exists but holds nothing is still a source: "zero turns" and
    // "no store" read differently on a first run.
    sources.names.push(db::APP);
    let opencode_rows = match opencode::read_rows(opencode_path, since_ms) {
        Ok(rows) => {
            sources.names.push(db::OPENCODE);
            rows
        }
        Err(why) => {
            sources.notes.push(format!(
                "{} not read ({why})",
                super::render::shorten(opencode_path)
            ));
            Vec::new()
        }
    };
    let covered: std::collections::HashSet<&str> = opencode_rows
        .iter()
        .filter_map(|row| row.upstream_session.as_deref())
        .collect();
    let mut rows: Vec<Row> = app
        .into_iter()
        .filter(|row| {
            // Drop the app's copy of a turn opencode holds: same turn, one record,
            // and opencode's is the complete one.
            let upstream = row.upstream_session.as_deref();
            !upstream.is_some_and(|session| covered.contains(session))
        })
        .collect();
    rows.extend(opencode_rows);
    rows.sort_by_key(|row| row.at_ms);
    sources.rows = rows;
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// The desktop store, minimal: one assistant turn with a usage event.
    fn app_store(dir: &std::path::Path) -> String {
        let path = dir.join("app.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
                 CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
                 CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, \
                 role TEXT, created_at INTEGER, events_json TEXT);
                 CREATE TABLE agent_sessions (conversation_id TEXT, agent_id TEXT, \
                 session_id TEXT, model TEXT, updated_at INTEGER);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messages VALUES ('m1', 'conv_1', 'assistant', 1000, \
                 '[{\"kind\":\"status\",\"label\":\"model\",\"detail\":\"deepseek-v4.1-flash\"},\
                 {\"kind\":\"usage\",\"inputTokens\":100,\"outputTokens\":10}]')",
                [],
            )
            .unwrap();
        path.to_string_lossy().into_owned()
    }

    /// A missing harness store is one note; the app's rows still render.
    #[test]
    fn a_missing_opencode_store_leaves_the_app_rows_alone() {
        let dir = tempfile::tempdir().unwrap();
        let app = app_store(dir.path());
        let sources = read(&app, "/nonexistent/opencode.db", 0).unwrap();
        assert_eq!(sources.rows.len(), 1, "{:?}", sources.rows);
        assert_eq!(sources.rows[0].source, db::APP);
        assert_eq!(sources.names, vec![db::APP]);
        assert_eq!(sources.notes.len(), 1);
        assert!(
            sources.notes[0].contains("opencode.db"),
            "{:?}",
            sources.notes
        );
        assert!(!sources.empty());
    }

    /// The app store is required — its absence is the exit a first run needs.
    #[test]
    fn an_absent_app_store_is_the_error() {
        let dir = tempfile::tempdir().unwrap();
        let sources = read(
            &dir.path().join("none.sqlite").to_string_lossy(),
            "/nonexistent/opencode.db",
            0,
        );
        assert!(sources.is_err(), "the app store is required");
    }
}
