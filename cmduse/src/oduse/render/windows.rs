// The dashboard's window rows: one row per cap the plan publishes.
//
// A window the plan does not publish has no row at all — Pro/Max never throttle
// on a 5-hour basis, so inventing a zero there would read as "0% of a $0 cap",
// which is a different claim from "no such cap". The same rule applies to the
// percentage and the gauge: absent, not zero.
use crate::oduse::window::Totals;
use cmduse_core::{money, pct};

use super::ink::Ink;

pub struct RowSpec<'a> {
    pub label: &'a str,
    pub used: &'a Totals,
    pub cap: Option<f64>,
    /// The period's real bounds (start, end) in epoch ms, for the monthly row
    /// only: the rolling cuts have no reset instant this machine can know.
    pub period: Option<(i64, i64)>,
    /// Whether the even-burn figure belongs here. Only the month is a budget, so
    /// only it gets "what even burn would have spent by now".
    pub pro_rata: bool,
    /// Set on a cut this machine made rather than a window the product anchors
    /// (Go's 5-hour block, the 7-day subscription cycle): the row carries the
    /// span it really measured, so a percentage of a published cap cannot read
    /// as the product's own window.
    pub rolling: Option<&'a str>,
}

pub fn window_line(ink: &Ink, spec: &RowSpec<'_>, now_ms: i64) -> String {
    let share = spec
        .cap
        .filter(|cap| *cap > 0.0)
        .map(|cap| spec.used.credits / cap * 100.0);
    let spent = money(spec.used.credits);
    // The gauge carries the share on a colour frame; the plain frame has no
    // gauge, so it keeps the figure.
    let paren = match (share, ink.colour) {
        (Some(_), true) => String::new(),
        (Some(_), false) => format!(
            " · {} of {}",
            pct(spec.used.credits, spec.cap.unwrap_or(0.0)),
            money(spec.cap.unwrap_or(0.0))
        ),
        (None, _) => String::new(),
    };
    let (elapsed, by_now, ends) = match spec.period {
        Some((start, end)) if end > start => {
            let dur = ((end - start) / 1000).max(0) as u64;
            let elapsed = cmduse_core::elapsed_pct(
                Some(end as f64),
                dur,
                Some((now_ms / 1000).max(0) as u64),
            );
            let ends = format!(" · ends {}", super::date_of(end / 86_400_000));
            let thru = elapsed
                .map(|p| format!(" · {}window {p:.1}% elapsed{}", ink.dim, ink.reset))
                .unwrap_or_default();
            let by_now = match (spec.pro_rata, elapsed, spec.cap) {
                (true, Some(p), Some(cap)) => {
                    format!(
                        " · {}{} by now{}",
                        ink.dim,
                        money(cap * p / 100.0),
                        ink.reset
                    )
                }
                _ => String::new(),
            };
            (thru, by_now, ends)
        }
        _ => (String::new(), String::new(), String::new()),
    };
    let flag = if share.is_some_and(|p| p >= 100.0) {
        format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
    } else {
        String::new()
    };
    // A local cut says which span it measured: the product's own window is
    // anchored somewhere this machine cannot know, so the row never claims to be
    // that window.
    let rolling = match spec.rolling {
        Some(span) => format!(" · {}rolling {span}{}", ink.dim, ink.reset),
        None => String::new(),
    };
    let body = format!("{spent}{paren}{rolling}{ends}{flag}{elapsed}{by_now}");
    if ink.colour {
        let bar = match share {
            Some(p) => format!("{} ", ink.bar_label(p, &given_pct(p))),
            None => String::new(),
        };
        format!(
            " {}{:<8}{} {}{bar}{body}{}\n",
            ink.bold, spec.label, ink.reset, ink.dim, ink.reset
        )
    } else {
        format!("  {:<8} {body}\n", spec.label)
    }
}

/// A computed percentage, one decimal and half-away (cmduse's rule). No figure
/// here arrives from a server, so unlike `ocuse` nothing is printed verbatim.
fn given_pct(value: f64) -> String {
    format!("{}", (value * 10.0).round() / 10.0)
}
