// The per-model table: one row per model the period touched, biggest spender
// first (that order is the aggregator's; this file only prints it).
//
// Split out of `dash` so the frame stays readable and both files stay under the
// repo's line cap.
use crate::oduse::window::{ModelUsage, Report, Totals};
use cmduse_core::{compact, money, pct};

use super::Ink;

/// The table alone: header, up to `rows` models, and a tail saying how many were
/// withheld. `rows` is the caller's `--rows` cap; the machine formats ignore it.
pub fn model_table(ink: &Ink, report: &Report, rows: usize) -> String {
    let name_w = report
        .models
        .iter()
        .take(rows)
        .map(|model| model.id.chars().count())
        .max()
        .unwrap_or(0)
        .max(28);
    let mut out = format!(
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
    );
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(ink, model, name_w, report.month.credits));
    }
    if report.models.len() > rows {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(format!("… {} more", report.models.len() - rows))
        ));
    }
    out
}

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
    // An unpriced model has no figure at all: `$0.00` there would claim it spent
    // nothing rather than that its rate is unknown.
    let window = |totals: &Totals| {
        if model.priced {
            ink.dim_on(format!("{:>8}", money(totals.credits)))
        } else {
            ink.dim_on(format!("{:>8}", "—"))
        }
    };
    format!(
        "{:<name_w$} {:>4} {credits} {share} {} {} {:>7}\n",
        model.id,
        format!("x{}", trim_multiplier(model.multiplier)),
        window(&model.five_hour),
        window(&model.weekly),
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
