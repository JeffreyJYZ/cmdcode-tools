// One tool call: the arguments the caller sent, resolved against the settings.
//
// Split from the JSON-RPC plumbing so the protocol half stays readable, and so
// the argument handling that the schema tests pin sits next to the schemas.
use crate::oduse::od;
use crate::oduse::window;
use crate::oduse::{db, period, render};
use serde_json::{json, Value};

use super::Settings;

pub fn tool_call(msg: &Value, settings: &Settings) -> Result<Value, (i64, String)> {
    let Settings {
        db_path,
        opencode_path,
        days,
        tz_secs,
        colour,
        plan,
        period_start,
        wallet,
        wallet_error,
        wallet_source,
    } = *settings;
    let name = msg
        .pointer("/params/name")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let args = msg
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or(json!({}));
    let number =
        |key: &str, fallback: i64| args.get(key).and_then(|v| v.as_i64()).unwrap_or(fallback);
    let tz = match args.get("tz").and_then(|v| v.as_str()) {
        None => tz_secs,
        Some(s) => crate::cli::parse_tz(s).ok_or((
            -32602,
            "tz needs an offset like +05:30 or -08:00".to_string(),
        ))?,
    };
    // Rows to list: `rows` (the CLI flag's name), `limit` still accepted because
    // it shipped first; no cap means every row.
    let rows_cap = |fallback: usize| -> usize {
        match args
            .get("rows")
            .or_else(|| args.get("limit"))
            .and_then(|v| v.as_u64())
        {
            Some(0) | None => fallback,
            Some(n) => n as usize,
        }
    };
    let since_ms = match args.get("since").and_then(|v| v.as_str()) {
        None => None,
        Some(s) => Some(cmduse_core::dates::parse_iso_utc(s).ok_or((
            -32602,
            format!("since needs an ISO-8601 instant, got '{s}'"),
        ))? as i64),
    };
    let plan_id = args
        .get("plan")
        .and_then(|v| v.as_str())
        .unwrap_or(plan)
        .to_string();
    let catalog = od::catalog();
    let Some(plan_cfg) = catalog.plan(&plan_id) else {
        return Err((
            -32602,
            format!("plan must be one of: {}", catalog.plan_ids().join(", ")),
        ));
    };

    let rows = || {
        let cutoff =
            since_ms.unwrap_or_else(|| window::now_ms() - number("days", days) * 86_400_000);
        crate::oduse::sources::read(db_path, opencode_path, cutoff)
    };
    let report = |rows: &[db::Row]| {
        let mut report = window::build(rows, &catalog, &plan_id, window::now_ms(), period_start);
        report.wallet = wallet.cloned();
        report.wallet_error = wallet_error.map(str::to_string);
        report.wallet_source = wallet_source;
        report.period_end_ms = period::end(report.since_ms, "month", report.month_inferred);
        report
    };
    // `model` takes its own `days`/`since`, like the CLI's `--days N | --since
    // ISO`: with neither pinned the period stays the CLI's (the calendar month),
    // but an explicit `days` must widen it too — otherwise the tool read the rows
    // and then counted only the month, answering "no completed turns in this
    // period" for history the store holds. The build filters by the start it is
    // given, so the widened start has to be passed in, not patched afterwards.
    let model_days = args.get("days").and_then(|v| v.as_i64());
    let (model_start, model_label, model_mode) = match (since_ms, model_days) {
        (Some(ms), _) => (Some(ms), "since (pinned)".to_string(), "month".to_string()),
        (None, Some(_)) => {
            let d = number("days", days);
            (
                Some(window::now_ms() - d * 86_400_000),
                format!("last {d}d"),
                format!("{d}d"),
            )
        }
        (None, None) => (
            period_start,
            "calendar month".to_string(),
            "month".to_string(),
        ),
    };
    let model_report = |rows: &[db::Row]| {
        let mut built = window::build(rows, &catalog, &plan_id, window::now_ms(), model_start);
        built.wallet = wallet.cloned();
        built.wallet_error = wallet_error.map(str::to_string);
        built.wallet_source = wallet_source;
        built.period_label = model_label.clone();
        built.period_end_ms = period::end(built.since_ms, &model_mode, built.month_inferred);
        built
    };

    let text = match name {
        "usage" => rows().map(|found| {
            let mut report = report(&found.rows);
            report.sources = found.names;
            report.notes = found.notes;
            render::render_text(
                &report,
                plan_cfg,
                db_path,
                15,
                colour,
                render::DEFAULT_BAR_WIDTH,
            )
        }),
        "plans" => Ok(render::plans_text(colour)),
        "models" => Ok(render::models_text(&plan_id, colour)),
        "daily" => rows().map(|found| {
            render::bucket_text(
                &found.rows,
                &catalog,
                window::now_ms(),
                number("days", days) * 86_400_000,
                86_400_000,
                tz,
                colour,
                crate::report_render::Fmt::Table,
                rows_cap(usize::MAX),
            )
        }),
        "hourly" => rows().map(|found| {
            render::bucket_text(
                &found.rows,
                &catalog,
                window::now_ms(),
                number("hours", 24) * 3_600_000,
                3_600_000,
                tz,
                colour,
                crate::report_render::Fmt::Table,
                rows_cap(usize::MAX),
            )
        }),
        "session" => rows().map(|found| {
            render::session_text(
                &found.rows,
                &catalog,
                rows_cap(usize::MAX),
                colour,
                crate::report_render::Fmt::Table,
            )
        }),
        "model" => rows().map(|found| {
            let mut report = model_report(&found.rows);
            report.sources = found.names;
            report.notes = found.notes;
            match args.get("id").and_then(|v| v.as_str()) {
                Some(wanted) => render::model_text(&report, wanted, colour),
                None => render::render_text(
                    &report,
                    plan_cfg,
                    db_path,
                    rows_cap(usize::MAX),
                    colour,
                    render::DEFAULT_BAR_WIDTH,
                ),
            }
        }),
        _ => {
            return Ok(json!({
                "content": [{ "type": "text", "text": format!("unknown tool: {name}") }],
                "isError": true,
            }))
        }
    };
    Ok(match text {
        Ok(body) => json!({ "content": [{ "type": "text", "text": body }] }),
        Err(error) => json!({
            "content": [{ "type": "text", "text": format!("error: {error}") }],
            "isError": true,
        }),
    })
}
