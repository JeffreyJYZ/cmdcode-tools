// The dashboard: one frame of windows, the wallet, and the per-model table.
//
// Nothing here is a server meter. OpenDesign publishes caps and no per-window
// usage API, so every figure is this store's own spend priced from the catalogue
// and cut by `window::build`; the wallet is the one number the app itself
// reports, and it is a balance rather than a window, so it prints beside the
// windows instead of replacing them.
use crate::oduse::od::Plan;
use crate::oduse::window::Report;
use cmduse_core::{compact, money};

use super::ink::Ink;
use super::model_table::model_table;
use super::shorten;
use super::wallet::wallet_line;
use super::windows::{window_line, RowSpec};

/// `limit` rows to show; `usize::MAX` for all.
pub fn render_text(
    report: &Report,
    plan: &Plan,
    db_path: &str,
    rows: usize,
    colour: bool,
    bar_width: usize,
) -> String {
    let ink = Ink::new(colour).width(bar_width);
    let c = |text: String| ink.cyan_on(text);
    // Both stores are named, the way the other binaries name their clients: a
    // total that grew because a second store was read must not look like drift.
    let sources = if report.sources.is_empty() {
        String::new()
    } else {
        format!("{} ({}){}", ink.dim, report.sources.join(" + "), ink.reset)
    };
    let mut out = format!(
        "{}OpenDesign usage{} — credits, from {}{}{}{}\n",
        ink.bold,
        ink.reset,
        ink.dim,
        shorten(db_path),
        ink.reset,
        sources,
    );
    let end = report
        .period_end_ms
        .map(|ms| format!(" · ends {}", super::date_of(ms / 86_400_000)))
        .unwrap_or_default();
    out.push_str(&format!(
        "period: {}{end} · {} requests · {} credits · {} in / {} out tokens\n",
        report.period_label,
        c(compact(report.month.requests)),
        c(money(report.month.credits)),
        c(compact(report.month.input)),
        c(compact(report.month.output)),
    ));
    out.push_str(&wallet_line(&ink, report));

    // The plan's published caps, then the windows they cap. A cap the plan does
    // not publish is absent from both, never zero.
    let mut caps = vec![format!("{}/month", money(plan.monthly_usd))];
    if let Some(week) = plan.weekly_usd {
        caps.push(format!("{}/week", money(week)));
    }
    if let Some(five) = plan.five_hour_usd {
        caps.push(format!("{}/5h", money(five)));
    }
    caps.push(format!("{} concurrent", plan.concurrency));
    out.push_str(&format!(
        "\n{}DESIGN {}{} {}\n",
        ink.bold,
        plan.label,
        ink.reset,
        ink.dim_on(caps.join(" · ")),
    ));
    if plan.five_hour_usd.is_some() {
        out.push_str(&window_line(
            &ink,
            &RowSpec {
                label: "5-hour",
                used: &report.five_hour,
                cap: plan.five_hour_usd,
                period: None,
                pro_rata: false,
                rolling: Some("5h"),
            },
            report.now_ms,
        ));
    }
    out.push_str(&window_line(
        &ink,
        &RowSpec {
            label: "Weekly",
            used: &report.weekly,
            cap: plan.weekly_usd,
            period: None,
            pro_rata: false,
            rolling: Some("7d"),
        },
        report.now_ms,
    ));
    out.push_str(&window_line(
        &ink,
        &RowSpec {
            label: "Monthly",
            used: &report.month,
            cap: Some(plan.monthly_usd),
            period: report
                .period_end_ms
                .map(|end| (report.since_ms.max(0), end.max(report.since_ms))),
            pro_rata: true,
            rolling: None,
        },
        report.now_ms,
    ));
    if plan.plan_model_credits_usd > 0.0 {
        // Published, with no local meter: the store names models, not which of
        // them are the plan's own, so no figure is invented for this allowance.
        out.push_str(&format!(
            "{}  plan-model credits {} (published allowance, no local meter){}\n",
            ink.dim,
            money(plan.plan_model_credits_usd),
            ink.reset,
        ));
    }

    out.push_str(&model_table(&ink, report, rows));
    out.push_str(&format!(
        "\n{}credits = list-price $ x the model's multiplier, cache reads included (priced from core/zen.json where that shelf carries the model); these are estimates.{}",
        ink.dim, ink.reset
    ));
    // A cache read priced at the input rate is still priced — say which, so the
    // figure is not mistaken for a published rate.
    if report.month.cache_estimated > 0 {
        out.push_str(&format!(
            "\n{}{} of {} turns price cache reads at the model's input rate; no published cache rate for that model.{}",
            ink.dim, report.month.cache_estimated, report.month.requests, ink.reset
        ));
    }
    // A store that could not be read is one dim line, never an error.
    for note in &report.notes {
        out.push_str(&format!("\n{}{note}{}", ink.dim, ink.reset));
    }
    // An unpriced turn is counted as a request and contributes no credits, so
    // the period total is short by its spend — say so rather than let a small
    // figure read as the whole truth.
    if report.month.unpriced > 0 {
        out.push_str(&format!(
            "\n{}{} of {} turns have no catalogue rate, so the period total is short by their spend.{}",
            ink.dim, report.month.unpriced, report.month.requests, ink.reset
        ));
    }
    let nothing = report.month.requests == 0;
    if nothing {
        out.push_str(&format!(
            "\n{}no completed turns in this period{}",
            ink.dim, ink.reset
        ));
    }
    out.push('\n');
    out
}
