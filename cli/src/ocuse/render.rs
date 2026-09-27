// ocuse's presentation: a one-shot dashboard, a status line, and JSON.
//
// Reuses cmduse-core's pure formatters (money/compact/pct/duration) so both
// tools read the same. Go's allowance is per model — not per account — so the
// header's window lines sum the caps of the models actually used this month and
// the table shows each model against its own limit; that distinction is the
// whole point of the Go plan.
use crate::ocuse::window::{ModelUsage, Report, Totals};
use crate::ocuse::zen;
use cmduse_core::{compact, duration, money, pct};

fn window_line(
    label: &str,
    used: &Totals,
    cap: Option<f64>,
    reset_ms: Option<i64>,
    now_ms: i64,
) -> String {
    let cap_text = match cap {
        Some(cap) if cap > 0.0 => format!(
            "{} / {} ({})",
            money(used.cost),
            money(cap),
            pct(used.cost, cap)
        ),
        _ => money(used.cost),
    };
    let reset = reset_ms
        .map(|at| {
            format!(
                " · resets {}",
                duration(((at - now_ms) / 1000).max(0) as u64)
            )
        })
        .unwrap_or_default();
    format!("  {label:<8} {cap_text}{reset}\n")
}

/// Sum of `limit * share` over the models used this month — an aggregate ceiling
/// across the models in play, since Go grants limits per model.
fn aggregate_cap(report: &Report, share: f64) -> Option<f64> {
    let total: f64 = report
        .models
        .iter()
        .filter(|m| m.month.cost > 0.0)
        .filter_map(|m| m.limit)
        .map(|limit| limit * share)
        .sum();
    (total > 0.0).then_some(total)
}

fn model_row(model: &ModelUsage) -> String {
    let limit = model.limit.map(money).unwrap_or_else(|| "—".into());
    let use_text = model
        .month_use()
        .map(|fraction| pct(fraction * 100.0, 100.0))
        .unwrap_or_else(|| "—".into());
    format!(
        "{:<28} {:>7} {:>10} {:>7} {:>8} {:>8} {:>7}\n",
        model.id,
        limit,
        money(model.month.cost),
        use_text,
        money(model.five_hour.cost),
        money(model.weekly.cost),
        compact(model.month.requests),
    )
}

/// `limit` rows to show; `usize::MAX` for all.
pub fn render_text(report: &Report, db_path: &str, rows: usize) -> String {
    let shares = &zen::catalog().go.window_share;
    let mut out = String::new();
    out.push_str(&format!(
        "OpenCode usage — go + zen, from {}\n",
        shorten(db_path)
    ));
    out.push_str(&format!(
        "period: {} · {} requests · {} · {} tokens\n",
        report.period_label,
        compact(report.month.requests),
        money(report.month.cost),
        compact(report.month.tokens()),
    ));

    if report.month.requests > 0 {
        let five_reset = report.now_ms + crate::ocuse::window::FIVE_HOUR_SECS * 1000;
        let week_reset = report.now_ms + crate::ocuse::window::WEEKLY_SECS * 1000;
        out.push_str("\nGO (limits are per model: 5h = 20%, weekly = 50%, monthly = 100%)\n");
        out.push_str(&window_line(
            "5-hour",
            &report.five_hour,
            aggregate_cap(report, shares.five_hour),
            Some(five_reset),
            report.now_ms,
        ));
        out.push_str(&window_line(
            "weekly",
            &report.weekly,
            aggregate_cap(report, shares.weekly),
            Some(week_reset),
            report.now_ms,
        ));
        out.push_str(&window_line(
            "monthly",
            &report.month,
            aggregate_cap(report, shares.monthly),
            None,
            report.now_ms,
        ));
    }

    out.push_str(
        "\nMODEL                            LIMIT      SPENT     USE       5H       WK     REQ\n",
    );
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(model));
    }
    if report.models.len() > rows {
        out.push_str(&format!("… {} more\n", report.models.len() - rows));
    }
    out.push_str(
        "\nZEN is pay-as-you-go: the same rows carry its spend, but the docs give no limit.\n",
    );
    out
}

/// Compact single line for a status bar.
pub fn status_line(report: &Report) -> String {
    match report.models.first() {
        Some(top) => format!(
            "oc {} month · {} 5h · top {} {}",
            money(report.month.cost),
            money(report.five_hour.cost),
            top.id,
            money(top.month.cost)
        ),
        None => format!(
            "oc {} month · {} 5h",
            money(report.month.cost),
            money(report.five_hour.cost)
        ),
    }
}

/// Machine-readable projection: totals plus the per-model breakdown.
pub fn render_json(report: &Report) -> String {
    let totals = |t: &Totals| serde_json::json!({ "cost": t.cost, "requests": t.requests, "tokens": t.tokens() });
    let model = |m: &ModelUsage| {
        serde_json::json!({
            "id": m.id,
            "provider": m.provider,
            "limit": m.limit,
            "month": totals(&m.month),
            "fiveHour": totals(&m.five_hour),
            "weekly": totals(&m.weekly),
        })
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "source": "opencode.db",
        "generatedAt": report.now_ms,
        "periodStart": report.since_ms,
        "periodInferred": report.month_inferred,
        "totals": {
            "month": totals(&report.month),
            "fiveHour": totals(&report.five_hour),
            "weekly": totals(&report.weekly),
        },
        "models": report.models.iter().map(model).collect::<Vec<_>>(),
    }))
    .expect("json")
}

fn shorten(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() => path.replacen(&home, "~", 1),
        _ => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ocuse::db::Row;

    fn report() -> Report {
        let now = 1_800_000_000_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 30.0,
            ..Default::default()
        }];
        crate::ocuse::window::build(&rows, &zen::catalog(), now, None)
    }

    #[test]
    fn text_shows_the_model_against_its_limit() {
        let text = render_text(&report(), "/tmp/opencode.db", 10);
        assert!(text.contains("glm-5.3-flash"), "{text}");
        assert!(text.contains("$60"), "the model's monthly limit: {text}");
        assert!(text.contains("50%"), "30 of 60 is half: {text}");
    }

    #[test]
    fn json_and_status_line_carry_the_totals() {
        let json = render_json(&report());
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["totals"]["month"]["cost"], 30.0);
        assert_eq!(parsed["models"][0]["id"], "glm-5.3-flash");
        assert!(status_line(&report()).contains("glm-5.3-flash"));
    }
}
