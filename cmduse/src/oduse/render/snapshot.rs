// One window row sourced from the account's snapshot. The numbers are the
// server's own credits and reset instant; dollars are derived through the one
// `CREDIT_TO_USD` constant, and the raw counts stay on the same line so a reader
// can check the conversion without a second request.
use crate::oduse::snapshot::Window;
use cmduse_core::{money, pct};

use super::ink::Ink;

/// A line in the same shape as the local window rows, with `snapshot` naming
/// the source. `left` is the server's `remaining / limit`, not a local cut.
pub fn window_line(ink: &Ink, label: &str, window: &Window) -> String {
    let left = pct(window.remaining_credits, window.limit_credits);
    let resets = window
        .reset_label()
        .map(|when| format!(" · resets {when}"))
        .unwrap_or_default();
    let body = format!(
        "{} used of {} · {} left ({}) · {}/{} credits · snapshot{}",
        money(window.used_usd()),
        money(window.limit_usd()),
        left,
        money(window.remaining_usd()),
        credits(window.remaining_credits),
        credits(window.limit_credits),
        resets,
    );
    if ink.colour {
        let used = 100.0 - window.left_pct().unwrap_or(0.0);
        let bar = format!(
            "{} ",
            ink.bar_label(used, &format!("{}", (used * 10.0).round() / 10.0))
        );
        format!(
            " {}{:<8}{} {}{bar}{body}{}\n",
            ink.bold, label, ink.reset, ink.dim, ink.reset
        )
    } else {
        format!("  {:<8} {body}\n", label)
    }
}

/// Credits are counts, not money: no cents on a whole number.
fn credits(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value}")
    }
}

/// The one dim line that names the source when no snapshot answered. A missing
/// credential is not a fault, so it gets the same quiet treatment as a closed
/// daemon; a named HTTP/parse failure is shown verbatim beside the fallback.
pub fn source_note(ink: &Ink, answered: bool, error: Option<&str>) -> String {
    let why = match (answered, error) {
        (true, _) => "account snapshot".to_string(),
        (false, Some(reason)) => format!("local estimate — {reason}"),
        (false, None) => "local estimate — no session cookie".to_string(),
    };
    format!("{}  windows: {why}{}\n", ink.dim, ink.reset)
}
