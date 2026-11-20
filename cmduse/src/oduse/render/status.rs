// oduse's status line: the same `{key}` template engine the other three use, so
// one `statusline_template` config drives every binary.
//
// Placeholders (case-insensitive):
//   {plan} {period}                plan id / period label
//   {month} {month_pct} {month_bar}
//   {five_hour} {five_hour_pct} {five_hour_bar}   (aliases {5h} {5h_pct} {5h_bar})
//   {weekly} {weekly_pct} {weekly_bar}            (aliases {wk} {wk_pct} {wk_bar})
//   {wallet}                       the daemon's balance, or a dash
//   {models}                       top model by period credits
//   {catalog}                      where the price table came from: live, cache,
//                                  or builtin
// Unknown placeholders are dropped; `|` and newlines are literal separators.
// The 5-hour and weekly figures come from the account snapshot when one answered,
// the same meter the dashboard prints; the local store is the fallback.
use crate::oduse::od::Plan;
use crate::oduse::window::Report;
use cmduse_core::{money, pct};

use super::ink::Ink;

pub fn statusline_template(
    report: &Report,
    plan: &Plan,
    tpl: &str,
    colours: bool,
    ascii: bool,
    bar_width: usize,
) -> String {
    let ink = Ink::new(colours);
    let cash = |v: f64| ink.cyan_on(money(v));
    let share = |used: f64, cap: Option<f64>| match cap.filter(|c| *c > 0.0) {
        Some(cap) => pct(used, cap),
        None => "—".to_string(),
    };
    let gauge = |used: f64, cap: Option<f64>| match cap.filter(|c| *c > 0.0) {
        Some(cap) => {
            let used_pct = used / cap * 100.0;
            crate::report_render::bar(used_pct, bar_width, ascii, colours)
        }
        None => String::new(),
    };
    let top_model = || {
        report
            .models
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_else(|| "—".into())
    };
    let wallet = || match &report.wallet {
        Some(wallet) => money(wallet.balance_usd),
        None => "—".to_string(),
    };
    // One resolver for all three surfaces: a machine consumer must not read a
    // local estimate while the frame beside it prints the account's number.
    let meter = super::json::window_meter(report, plan);
    // The month still divides by the set its own models draw on: a DeepSeek V4.1
    // Flash month is capped at $120 on Go, not the $220 the Eco variant gets.
    let month =
        crate::oduse::window::window_caps(&report.models, plan, crate::oduse::window::Span::Month);
    crate::report_render::render_template(tpl, |key| match key {
        "plan" => plan.id.clone(),
        "period" => report.period_label.clone(),
        "month" => cash(report.month.credits),
        "month_pct" => share(report.month.credits, Some(month.chosen.monthly_usd)),
        "month_bar" => gauge(report.month.credits, Some(month.chosen.monthly_usd)),
        "five_hour" | "5h" => cash(meter.five_hour_spent),
        "five_hour_pct" | "5h_pct" => share(meter.five_hour_spent, meter.five_hour_cap),
        "five_hour_bar" | "5h_bar" => gauge(meter.five_hour_spent, meter.five_hour_cap),
        "weekly" | "wk" => cash(meter.weekly_spent),
        "weekly_pct" | "wk_pct" => share(meter.weekly_spent, meter.weekly_cap),
        "weekly_bar" | "wk_bar" => gauge(meter.weekly_spent, meter.weekly_cap),
        "wallet" => wallet(),
        "models" => top_model(),
        "catalog" => crate::oduse::od::catalog().provenance.label(),
        _ => String::new(),
    })
}

/// `oduse statusline --json`: the same numbers the template and the dashboard
/// frame resolve. The `*Cap` keys are filled here rather than null — OpenDesign
/// publishes caps, unlike Go's per-model allowances — and a cap the plan does
/// not publish is null, which is why the 5-hour one is null on Plus/Pro/Max with
/// no snapshot answer. `meterSource` names the meter behind the 5h/weekly figures;
/// `source` keeps its older meaning, the store the rows came from.
pub fn statusline_json(report: &Report, plan: &Plan) -> String {
    // One resolver for all three surfaces: a machine consumer must not read a
    // local estimate while the frame beside it prints the account's number.
    let meter = super::json::window_meter(report, plan);
    // The caps a consumer divides by are the ones the window's own models draw
    // on, not the plan's headline set: a report on DeepSeek V4.1 Flash is capped
    // at $120/mo on Go, not the $220 the Eco variant gets.
    let month =
        crate::oduse::window::window_caps(&report.models, plan, crate::oduse::window::Span::Month);
    // The catalogue's origin, read from the one shared object so this surface
    // cannot drift from the dashboard's `catalog`.
    let catalog = super::catalog_json();
    serde_json::json!({
        "plan": plan.id,
        "source": "open-design",
        // Which price table priced the figures: live, cache (with its age) or the
        // baked seed. A consumer must never read a seed figure as a live one.
        "catalogSource": catalog["source"],
        "catalogAt": catalog["at"],
        "catalogAgeSecs": catalog["ageSecs"],
        // `snapshotError` is the key the dashboard JSON emits: null unless a
        // cookie was present and the request failed.
        "meterSource": meter.source.as_str(),
        "snapshotError": report.snapshot_error,
        "period": report.period_label,
        "periodEnd": report.period_end_ms,
        "monthSpent": report.month.credits,
        "monthCap": month.chosen.monthly_usd,
        "fiveHourSpent": meter.five_hour_spent,
        "fiveHourCap": meter.five_hour_cap,
        "weeklySpent": meter.weekly_spent,
        "weeklyCap": meter.weekly_cap,
        "model": report.models.first().map(|m| m.id.clone()),
        // The aliases keep their cmduse meaning; the wallet is a balance in
        // dollars, not a credit remainder, so this one stays null.
        "fiveHourUsed": meter.five_hour_spent,
        "weeklyUsed": meter.weekly_spent,
        "monthlyRemaining": serde_json::Value::Null,
        // Unit-specific extras with no counterpart on the other three binaries:
        // which per-model cap set was chosen, and the wallet daemon's balance.
        "capLabel": month.chosen.label,
        "walletUsd": report.wallet.as_ref().map(|w| w.balance_usd),
        "walletSource": report.wallet_source.map(|s| s.as_str()),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oduse_statusline_json_carries_the_shared_keys() {
        // This test lives beside the emitter, not in oduse/tests/**: that tree
        // is owned by another lane this round, and the shared key assertion
        // must not wait on it. A hand-built empty report is enough for a shape.
        let catalog = crate::oduse::od::catalog();
        let report = crate::oduse::window::build(
            &[],
            &catalog,
            crate::oduse::od::DEFAULT_PLAN,
            1_800_000_000_000,
            Some(crate::oduse::window::calendar_month_start(
                1_800_000_000_000,
            )),
        );
        let plan = catalog.plan(crate::oduse::od::DEFAULT_PLAN).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&statusline_json(&report, plan)).unwrap();
        crate::report_render::assert_statusline_keys(&json);
        // Unit-specific extras stay; they name concepts no family has.
        assert!(json.get("capLabel").is_some());
        assert!(json.get("walletUsd").is_some());
        assert!(json.get("walletSource").is_some());
        // Provenance rides beside them, always present.
        assert_eq!(json["catalogSource"], "builtin");
        assert!(json.get("catalogAt").is_some());
        assert!(json.get("catalogAgeSecs").is_some());
    }

    #[test]
    fn the_catalog_placeholder_names_the_table_origin() {
        let catalog = crate::oduse::od::catalog();
        let report = crate::oduse::window::build(
            &[],
            &catalog,
            crate::oduse::od::DEFAULT_PLAN,
            1_800_000_000_000,
            None,
        );
        let plan = catalog.plan(crate::oduse::od::DEFAULT_PLAN).unwrap();
        let text = statusline_template(&report, plan, "{catalog}", false, false, 20);
        assert_eq!(text, "builtin");
    }
}
