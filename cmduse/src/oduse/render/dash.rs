// The dashboard: one frame of windows, the wallet, and the per-model table.
//
// Nothing here is a server meter. OpenDesign publishes caps and no per-window
// usage API, so every figure is this store's own spend priced from the catalogue
// and cut by `window::build`; the wallet is the one number the app itself
// reports, and it is a balance rather than a window, so it prints beside the
// windows instead of replacing them.
use crate::oduse::od::Plan;
use crate::oduse::window::{ModelUsage, Report};
use cmduse_core::{compact, money, pct};

use super::ink::Ink;
use super::shorten;
use super::wallet::wallet_line;
use super::windows::{window_line, RowSpec};

/// One model row: multiplier, month credits, share of period credits, the two
/// rolling windows' credits, and requests.
fn model_row(ink: &Ink, model: &ModelUsage, name_w: usize, total: f64) -> String {
    let credits = if model.priced {
        ink.cyan_on(format!("{:>10}", money(model.month.credits)))
    } else {
        ink.dim_on(format!("{:>10}", "—"))
    };
    let share = if model.priced && total > 0.0 {
        format!("{:>7}", pct(model.month.credits, total))
    } else {
        ink.dim_on(format!("{:>7}", "—"))
    };
    format!(
        "{:<name_w$} {:>4} {credits} {share} {} {} {:>7}\n",
        model.id,
        format!("x{}", trim_multiplier(model.multiplier)),
        ink.dim_on(format!("{:>8}", money(model.five_hour.credits))),
        ink.dim_on(format!("{:>8}", money(model.weekly.credits))),
        compact(model.month.requests),
        name_w = name_w,
    )
}

/// `x0.5`, never `x0.50`; `x1`, never `x1.0`.
fn trim_multiplier(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if (rounded - rounded.round()).abs() < f64::EPSILON {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded}")
    }
}

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
    let mut out = format!(
        "{}OpenDesign usage{} — credits, from {}{}{}\n",
        ink.bold,
        ink.reset,
        ink.dim,
        shorten(db_path),
        ink.reset,
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

    let name_w = report
        .models
        .iter()
        .take(rows)
        .map(|model| model.id.chars().count())
        .max()
        .unwrap_or(0)
        .max(28);
    out.push_str(&format!(
        "\n{}{:<name_w$} {:>4} {:>10} {:>7} {:>8} {:>8} {:>7}{}\n",
        ink.bold,
        "MODEL",
        "MULT",
        "CREDITS",
        "SHARE",
        "5H",
        "WK",
        "REQ",
        ink.reset,
        name_w = name_w
    ));
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(&ink, model, name_w, report.month.credits));
    }
    if report.models.len() > rows {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(format!("… {} more", report.models.len() - rows))
        ));
    }
    out.push_str(&format!(
        "\n{}credits = list-price $ x the model's multiplier; the store records no cache tokens, so these are estimates.{}",
        ink.dim, ink.reset
    ));
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
