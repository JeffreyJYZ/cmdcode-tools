// The store reader: the exact event shape the app writes, plus the two failure
// modes a first run meets (no store, an empty one).
use crate::oduse::db::{parse_events, read_rows};
use rusqlite::Connection;

/// A miniature store, shaped like the app's own (verified 2026-11-16).
fn fixture() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.sqlite");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
             CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, \
             role TEXT, created_at INTEGER, events_json TEXT);",
        )
        .unwrap();
    let insert = |id: &str, role: &str, at: i64, events: &str| {
        connection
            .execute(
                "INSERT INTO messages VALUES (?, 'conv_1', ?, ?, ?)",
                (id, role, at, events),
            )
            .unwrap();
    };
    connection
        .execute(
            "INSERT INTO projects VALUES ('proj_1', 'Greeting and Next Steps')",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO conversations VALUES ('conv_1', 'proj_1', 'Greeting')",
            [],
        )
        .unwrap();
    insert(
        "msg_user",
        "user",
        1_792_409_364_317,
        r#"[{"kind":"status","label":"starting","detail":"amr"}]"#,
    );
    insert(
        "msg_assistant",
        "assistant",
        1_792_409_365_400,
        r#"[{"kind":"status","label":"starting","detail":"amr"},
            {"kind":"done_key","key":"32c813c09bddc73b"},
            {"kind":"status","label":"model","detail":"deepseek-v4.1-flash"},
            {"kind":"diagnostic","name":"prompt_budget_v1","source":"acp-json-rpc"},
            {"kind":"usage","inputTokens":30892,"outputTokens":147,"durationMs":11086}]"#,
    );
    // An in-flight turn: model known, no usage event yet.
    insert(
        "msg_inflight",
        "assistant",
        1_792_409_366_000,
        r#"[{"kind":"status","label":"model","detail":"glm-5.3-flash"}]"#,
    );
    (dir, path.to_string_lossy().into_owned())
}

#[test]
fn reads_the_exact_event_shape_the_app_writes() {
    let (_dir, path) = fixture();
    let rows = read_rows(&path, 0).unwrap();
    assert_eq!(rows.len(), 1, "{rows:#?}");
    let row = &rows[0];
    assert_eq!(row.model, "deepseek-v4.1-flash");
    assert_eq!(row.input, 30_892);
    assert_eq!(row.output, 147);
    assert_eq!(row.duration_ms, Some(11_086));
    assert_eq!(row.session, "conv_1");
    assert_eq!(row.project, "Greeting and Next Steps");
}

#[test]
fn the_window_filters_on_created_at() {
    let (_dir, path) = fixture();
    assert!(read_rows(&path, 1_792_409_366_000).unwrap().is_empty());
    assert_eq!(read_rows(&path, 1_792_409_365_400).unwrap().len(), 1);
}

#[test]
fn a_missing_store_is_an_error_not_a_panic() {
    let error = read_rows("/nonexistent/app.sqlite", 0).unwrap_err();
    assert!(error.contains("open"), "{error}");
}

#[test]
fn an_empty_store_reads_as_no_rows() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.sqlite");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
             CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, \
             role TEXT, created_at INTEGER, events_json TEXT);",
        )
        .unwrap();
    assert!(read_rows(&path.to_string_lossy(), 0).unwrap().is_empty());
}

#[test]
fn events_without_usage_are_not_a_turn() {
    assert!(parse_events("[]").is_none());
    assert!(parse_events("not json").is_none());
    assert!(parse_events(r#"[{"kind":"status","label":"model","detail":"x"}]"#).is_none());
    // A usage event with no model still counts; the id is simply unknown.
    let turn = parse_events(r#"[{"kind":"usage","inputTokens":1,"outputTokens":2}]"#)
        .expect("usage alone is a turn");
    assert_eq!(turn.model, "");
    assert_eq!((turn.input, turn.output), (1, 2));
    assert_eq!(turn.duration_ms, None);
}

#[test]
fn the_default_path_is_the_apps_own_namespace() {
    // A canonical path is returned even when nothing exists, so a first run's
    // error names where the app will create the store.
    let path = crate::oduse::db::default_path();
    assert!(path.ends_with("app.sqlite"), "{path}");
}
