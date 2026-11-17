// `--rows`: a display cap on every multi-row table (`daily`, `hourly`, `model`,
// `session`), never on the machine formats, and never a tail when nothing was
// withheld.
use super::fixture::{live_report, plan, NOW_MS};
use crate::oduse::db::Row;
use crate::oduse::render::{self, DEFAULT_BAR_WIDTH};
use crate::report_render::Fmt;

/// Models the fixture catalog prices, so every table has real rows to trim.
const MODELS: [&str; 4] = [
    "deepseek-v4.1-flash",
    "glm-5.3-flash",
    "kimi-k2.7-code",
    "minimax-m3",
];

/// One turn per model, each in its own session and on its own day, so the day,
/// session and model tables all have exactly `MODELS.len()` rows.
fn rows() -> Vec<Row> {
    MODELS
        .iter()
        .enumerate()
        .map(|(i, model)| Row {
            at_ms: NOW_MS - 60_000 - i as i64 * 86_400_000,
            session: format!("conv_{i}"),
            project: format!("project-{i}"),
            model: (*model).into(),
            input: 100_000,
            output: 500,
            duration_ms: Some(1_000),
        })
        .collect()
}

#[test]
fn the_daily_and_hourly_tables_trim_and_say_how_much() {
    let catalog = super::fixture::catalog();
    let rows = rows();
    let day = 86_400_000;
    let daily = render::bucket_text(
        &rows,
        &catalog,
        NOW_MS,
        7 * day,
        day,
        0,
        false,
        Fmt::Table,
        2,
    );
    assert!(daily.contains("… 2 more"), "two days withheld: {daily}");
    assert_eq!(daily.lines().count(), 4, "header + 2 + tail: {daily}");
    let full = render::bucket_text(
        &rows,
        &catalog,
        NOW_MS,
        7 * day,
        day,
        0,
        false,
        Fmt::Table,
        usize::MAX,
    );
    assert!(
        !full.contains("more"),
        "nothing trimmed means no tail: {full}"
    );
    // `hourly` is the same renderer with a 1h bucket.
    let hourly = render::bucket_text(
        &rows,
        &catalog,
        NOW_MS,
        7 * day,
        3_600_000,
        0,
        false,
        Fmt::Table,
        1,
    );
    assert!(hourly.contains("… 3 more"), "{hourly}");
}

#[test]
fn the_daily_json_carries_every_bucket_even_when_the_table_is_capped() {
    let catalog = super::fixture::catalog();
    let day = 86_400_000;
    let json: serde_json::Value = serde_json::from_str(&render::bucket_text(
        &rows(),
        &catalog,
        NOW_MS,
        7 * day,
        day,
        0,
        false,
        Fmt::Json,
        1,
    ))
    .unwrap();
    assert_eq!(json["days"].as_object().unwrap().len(), MODELS.len());
    let keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    assert_eq!(keys, ["days", "scope", "source", "total"]);
    let csv = render::bucket_text(
        &rows(),
        &catalog,
        NOW_MS,
        7 * day,
        day,
        0,
        false,
        Fmt::Csv,
        1,
    );
    // Header + every bucket + the total row.
    assert_eq!(csv.lines().count(), MODELS.len() + 2, "{csv}");
}

#[test]
fn the_model_table_caps_its_rows_and_the_machine_format_does_not() {
    let report = super::fixture::report(&rows());
    let table = render::render_text(
        &report,
        &plan("go"),
        "/tmp/a.db",
        2,
        false,
        DEFAULT_BAR_WIDTH,
    );
    assert!(table.contains("… 2 more"), "two models withheld: {table}");
    let full = render::render_text(
        &report,
        &plan("go"),
        "/tmp/a.db",
        usize::MAX,
        false,
        DEFAULT_BAR_WIDTH,
    );
    assert!(!full.contains("more"), "nothing trimmed: {full}");
    let parsed: serde_json::Value =
        serde_json::from_str(&render::model_report(&report, None, Fmt::Json)).unwrap();
    assert_eq!(parsed["models"].as_object().unwrap().len(), MODELS.len());
}

#[test]
fn the_session_table_caps_its_rows_and_the_csv_keeps_them_all() {
    let rows = rows();
    let catalog = super::fixture::catalog();
    let table = render::session_text(&rows, &catalog, 1, false, Fmt::Table);
    assert!(table.contains("… 3 more"), "{table}");
    assert_eq!(table.lines().count(), 3, "header + 1 + tail: {table}");
    let csv = render::session_text(&rows, &catalog, 1, false, Fmt::Csv);
    assert_eq!(
        csv.lines().count(),
        rows.len() + 1,
        "header + every session"
    );
}

/// The one-row live fixture must not grow a tail: a table that shows everything
/// is not trimmed, so that line would be a lie.
#[test]
fn a_single_row_table_has_no_tail() {
    let report = live_report();
    let table = render::render_text(&report, &plan("go"), "/tmp/a.db", 1, false, 20);
    assert!(!table.contains("more"), "{table}");
}
