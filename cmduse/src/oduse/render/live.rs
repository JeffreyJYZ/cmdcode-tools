// The live surfaces: one watch frame, one compact line for tiny terminals.
//
// Both end without a trailing newline: the caller appends its own status line
// and `redraw_frame` parks the cursor on that last row, which is what lets the
// countdown rewrite a single line per second instead of repainting.
use crate::oduse::od::Plan;
use crate::oduse::window::{self, Report, Span};

use super::dash::render_text;
use super::ink::Ink;

/// The full frame plus a burst sparkline when spend moved since the last refresh.
#[allow(clippy::too_many_arguments)]
pub fn watch_frame(
    report: &Report,
    plan: &Plan,
    db_path: &str,
    rows: usize,
    colour: bool,
    history: &[f64],
    interval_secs: u64,
    bar_width: usize,
) -> String {
    let ink = Ink::new(colour);
    let mut out = render_text(report, plan, db_path, rows, colour, bar_width);
    if history.len() >= 2 && history.iter().any(|v| *v > 0.0) {
        out.push_str(&format!(
            "{}spend bursts ({}s samples){} {}\n",
            ink.dim,
            interval_secs,
            ink.reset,
            crate::render::sparkline(history),
        ));
    }
    out.trim_end_matches('\n').to_string()
}

/// Minimal one-line dashboard for terminals too small for the full frame: period
/// credits against the plan's monthly cap, then the wallet when it answered.
pub fn compact_line(report: &Report, plan: &Plan, history: &[f64], colour: bool) -> String {
    let ink = Ink::new(colour);
    let spark = if history.len() >= 2 && history.iter().any(|v| *v > 0.0) {
        format!(
            " {}{}{}",
            ink.dim,
            crate::render::sparkline(history),
            ink.reset
        )
    } else {
        String::new()
    };
    let wallet = report
        .wallet
        .as_ref()
        .map(|w| {
            let via = report
                .wallet_source
                .map(|s| format!(" ({})", s.as_str()))
                .unwrap_or_default();
            format!(" · wallet {}{via}", cmduse_core::money(w.balance_usd))
        })
        .unwrap_or_default();
    // The month is bounded by the cap set its own models draw on: a report
    // holding the original Flash is capped at $120 on Go, not the $220 headline.
    // A bare $220 here was the same overstatement the full frame no longer makes.
    let month = window::window_caps(&report.models, plan, Span::Month);
    format!(
        "{}od{} {}/{} ({}) month · 5h {}{wallet}{spark}",
        ink.bold,
        ink.reset,
        ink.cyan_on(cmduse_core::money(report.month.credits)),
        cmduse_core::money(month.chosen.monthly_usd),
        month.chosen.label,
        ink.cyan_on(cmduse_core::money(report.five_hour.credits)),
    )
}
