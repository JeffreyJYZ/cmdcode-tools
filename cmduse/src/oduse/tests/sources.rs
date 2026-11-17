// The second source: `opencode.db`'s `open-design*` rows, how they join the app
// store, and the two properties the brief calls out — the provider match is a
// prefix (a rename cannot drop turns) and a proxied turn is counted once.
use crate::oduse::db::{self, APP, OPENCODE};
use crate::oduse::opencode::is_plan_provider;
use crate::oduse::sources;
use rusqlite::Connection;

/// Both provider spellings live at once: the provider block and its `-tmp` twin.
#[test]
fn the_provider_match_is_a_prefix_not_a_name() {
    assert!(is_plan_provider("open-design"));
    assert!(is_plan_provider("open-design-tmp"));
    // A future rename keeps working, which is the whole point.
    assert!(is_plan_provider("open-design-v2"));
    assert!(!is_plan_provider("openrouter"));
    assert!(!is_plan_provider("opencode-go"));
}

/// The app store, minimal: one assistant turn with a usage event and the upstream
/// opencode session it proxies.
fn app_store(dir: &std::path::Path, upstream: Option<&str>) -> String {
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
    let events = r#"[{"kind":"status","label":"model","detail":"deepseek-v4.1-flash"},
        {"kind":"usage","inputTokens":100,"outputTokens":10}]"#;
    connection
        .execute(
            "INSERT INTO messages VALUES ('m1', 'conv_1', 'assistant', 1000, ?)",
            [events],
        )
        .unwrap();
    if let Some(session) = upstream {
        connection
            .execute(
                "INSERT INTO agent_sessions VALUES ('conv_1', 'amr-opencode', ?, \
                 'deepseek-v4.1-flash', 1000)",
                [session],
            )
            .unwrap();
    }
    path.to_string_lossy().into_owned()
}

/// `opencode.db`, minimal: `session_message` rows on the given provider.
fn opencode_store(dir: &std::path::Path, rows: &[(&str, &str)]) -> String {
    let path = dir.join("opencode.db");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, \
             seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT);",
        )
        .unwrap();
    for (i, (provider, session)) in rows.iter().enumerate() {
        let at = 1_000 + i as i64 * 1_000;
        let data = format!(
            r#"{{"model":{{"id":"deepseek-v4.1-flash","providerID":"{provider}"}},"cost":0,"tokens":{{"input":1000,"output":100,"cache":{{"read":5000,"write":0}}}}}}"#
        );
        connection
            .execute(
                "INSERT INTO session_message VALUES (?, ?, 'assistant', 0, ?, ?, ?)",
                (format!("msg_{at}"), session, at, at, data),
            )
            .unwrap();
    }
    path.to_string_lossy().into_owned()
}

/// Both spellings are counted, so the total is non-zero and names both sources.
#[test]
fn both_provider_spellings_are_counted() {
    let dir = tempfile::tempdir().unwrap();
    let app = app_store(dir.path(), None);
    let harness = opencode_store(
        dir.path(),
        &[("open-design", "ses_a"), ("open-design-tmp", "ses_b")],
    );
    let found = sources::read(&app, &harness, 0).unwrap();
    assert_eq!(found.rows.len(), 3, "{:#?}", found.rows);
    assert_eq!(found.names, vec![APP, OPENCODE]);
    let from_harness = found
        .rows
        .iter()
        .filter(|row| row.source == OPENCODE)
        .count();
    assert_eq!(from_harness, 2);
    // Cache reads belong to the harness store, which is the point of reading it.
    assert_eq!(
        found
            .rows
            .iter()
            .filter(|row| row.source == OPENCODE)
            .map(|row| row.cache_read)
            .sum::<u64>(),
        10_000
    );
    // The whole point of the bug: a store full of turns must not report zero.
    let report = crate::oduse::window::build(
        &found.rows,
        &crate::oduse::od::catalog(),
        crate::oduse::od::DEFAULT_PLAN,
        2_000,
        Some(0),
    );
    assert_eq!(report.month.requests, 3);
    assert!(report.month.credits > 0.0, "{:#?}", report.month);
}

/// A proxied turn visible from both sides counts once, and opencode's copy wins:
/// it carries the cache counters the app store cannot.
#[test]
fn a_proxied_turn_is_counted_once_and_the_harness_copy_wins() {
    let dir = tempfile::tempdir().unwrap();
    let app = app_store(dir.path(), Some("ses_shared"));
    let harness = opencode_store(
        dir.path(),
        &[
            ("open-design-tmp", "ses_shared"),
            ("open-design", "ses_other"),
        ],
    );
    let found = sources::read(&app, &harness, 0).unwrap();
    assert_eq!(found.rows.len(), 2, "{:#?}", found.rows);
    assert!(
        found.rows.iter().all(|row| row.source == OPENCODE),
        "the app's copy of the same session is dropped: {:#?}",
        found.rows
    );
    assert!(found.rows.iter().all(|row| row.cache_read == 5_000));
}

/// A rename moves the app's conversation onto no upstream session, so nothing
/// is dropped: an absent key never matches.
#[test]
fn an_app_turn_without_an_upstream_session_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let app = app_store(dir.path(), None);
    let harness = opencode_store(dir.path(), &[("open-design", "ses_x")]);
    let found = sources::read(&app, &harness, 0).unwrap();
    assert_eq!(found.rows.len(), 2);
    assert!(found.rows.iter().any(|row| row.source == APP));
    assert!(found.rows.iter().any(|row| row.source == OPENCODE));
}

/// A provider outside the family stays out, even in the same store.
#[test]
fn another_provider_in_the_same_store_is_not_this_plan() {
    let dir = tempfile::tempdir().unwrap();
    let app = app_store(dir.path(), None);
    let harness = opencode_store(
        dir.path(),
        &[("open-design", "ses_a"), ("opencode-go", "ses_b")],
    );
    let found = sources::read(&app, &harness, 0).unwrap();
    let counted = found
        .rows
        .iter()
        .filter(|row| row.source == OPENCODE)
        .count();
    assert_eq!(counted, 1, "{:#?}", found.rows);
}

/// Reported per store, so a consumer can tell which store answered.
#[test]
fn rows_carry_their_source() {
    let dir = tempfile::tempdir().unwrap();
    let app = app_store(dir.path(), Some("ses_other"));
    let harness = opencode_store(dir.path(), &[("open-design", "ses_a")]);
    let found = sources::read(&app, &harness, 0).unwrap();
    let sources_seen: Vec<&str> = found.rows.iter().map(|row| row.source).collect();
    assert_eq!(sources_seen, vec![APP, OPENCODE]);
    assert_eq!(db::APP, "app");
}
