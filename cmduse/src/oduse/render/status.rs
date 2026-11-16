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
// Unknown placeholders are dropped; `|` and newlines are literal separators.
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
    crate::report_render::render_template(tpl, |key| match key {
        "plan" => plan.id.clone(),
        "period" => report.period_label.clone(),
        "month" => cash(report.month.credits),
        "month_pct" => share(report.month.credits, Some(plan.monthly_usd)),
        "month_bar" => gauge(report.month.credits, Some(plan.monthly_usd)),
        "five_hour" | "5h" => cash(report.five_hour.credits),
        "five_hour_pct" | "5h_pct" => share(report.five_hour.credits, plan.five_hour_usd),
        "five_hour_bar" | "5h_bar" => gauge(report.five_hour.credits, plan.five_hour_usd),
        "weekly" | "wk" => cash(report.weekly.credits),
        "weekly_pct" | "wk_pct" => share(report.weekly.credits, plan.weekly_usd),
        "weekly_bar" | "wk_bar" => gauge(report.weekly.credits, plan.weekly_usd),
        "wallet" => wallet(),
        "models" => top_model(),
        _ => String::new(),
    })
}

/// `oduse statusline --json`: the same numbers the template resolves. The
/// `*Cap` keys are filled here rather than null — OpenDesign publishes caps,
/// unlike Go's per-model allowances — and a cap the plan does not publish is
/// null, which is why the 5-hour one is null on Plus/Pro/Max.
pub fn statusline_json(report: &Report, plan: &Plan) -> String {
    serde_json::json!({
        "plan": plan.id,
        "period": report.period_label,
        "monthSpent": report.month.credits,
        "monthCap": plan.monthly_usd,
        "fiveHourSpent": report.five_hour.credits,
        "fiveHourCap": plan.five_hour_usd,
        "weeklySpent": report.weekly.credits,
        "weeklyCap": plan.weekly_usd,
        "walletUsd": report.wallet.as_ref().map(|w| w.balance_usd),
        "model": report.models.first().map(|m| m.id.clone()),
    })
    .to_string()
}
