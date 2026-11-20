// The dashboard: one frame of windows, the wallet, and the per-model table.
//
// Nothing here is a server meter. OpenDesign publishes caps and no per-window
// usage API, so every figure is this store's own spend priced from the catalogue
// and cut by `window::build`; the wallet is the one number the app itself
// reports, and it is a balance rather than a window, so it prints beside the
// windows instead of replacing them.
//
// The caps are per model class, so each row asks `window_caps` which set its own
// models draw on and says so when that is not the plan's headline set.
use crate::oduse::od::Plan;
use crate::oduse::window::{self, Report, Span};
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
    // Which price table priced every figure below: the live list, its cache, or
    // the baked seed (with the reason). A stale fallback must never read fresh.
    let catalog = crate::oduse::od::catalog();
    out.push_str(&catalogue_line(&ink, &catalog));
    out.push_str(&wallet_line(&ink, report));

    let caps = super::caps::caps_heading(&ink, plan);
    out.push_str(&format!(
        "\n{}DESIGN {}{} {}\n",
        ink.bold, plan.label, ink.reset, caps,
    ));
    // One line names the source of the window figures. The account's snapshot
    // wins below; without it the local cuts remain, and the reason is said here.
    out.push_str(&super::snapshot::source_note(
        &ink,
        report.snapshot.is_some(),
        report.snapshot_error.as_deref(),
    ));
    let five = window::window_caps(&report.models, plan, Span::FiveHour);
    let week = window::window_caps(&report.models, plan, Span::Weekly);
    let month = window::window_caps(&report.models, plan, Span::Month);
    if let Some(window) = report.snapshot.as_ref().and_then(|s| s.five_hour()) {
        out.push_str(&super::snapshot::window_line(&ink, "5-hour", window));
    } else if five.chosen.five_hour_usd.is_some() {
        out.push_str(&window_line(
            &ink,
            &RowSpec {
                label: "5-hour",
                used: &report.five_hour,
                cap: five.chosen.five_hour_usd,
                cap_note: super::caps::cap_note(
                    &five,
                    five.looser.as_ref().and_then(|l| l.five_hour_usd),
                ),
                period: None,
                anchored: false,
                pro_rata: false,
                rolling: Some("5h"),
            },
            report.now_ms,
        ));
    }
    if let Some(window) = report.snapshot.as_ref().and_then(|s| s.weekly()) {
        out.push_str(&super::snapshot::window_line(&ink, "Weekly", window));
    } else {
        out.push_str(&window_line(
            &ink,
            &RowSpec {
                label: "Weekly",
                used: &report.weekly,
                cap: week.chosen.weekly_usd,
                cap_note: super::caps::cap_note(
                    &week,
                    week.looser.as_ref().and_then(|l| l.weekly_usd),
                ),
                period: None,
                anchored: false,
                pro_rata: false,
                rolling: Some("7d"),
            },
            report.now_ms,
        ));
    }
    out.push_str(&window_line(
        &ink,
        &RowSpec {
            label: "Monthly",
            used: &report.month,
            cap: Some(month.chosen.monthly_usd),
            cap_note: super::caps::cap_note(&month, month.looser.as_ref().map(|l| l.monthly_usd)),
            period: report
                .period_end_ms
                .map(|end| (report.since_ms.max(0), end.max(report.since_ms))),
            anchored: report.period_anchored,
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
        "\n{}credits = list-price $ x the model's multiplier; cache reads priced from Open Design's published model-prices list. Only a rate with no published source is an estimate, and any turn priced that way is counted below.{}",
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

/// One dim line naming the price table's origin. `live` and `cache, 3h old` both
/// carry the count of rows whose rates came from the published list; `builtin`
/// names the seed date and the reason, so a stale fallback cannot be mistaken
/// for a fresh answer.
fn catalogue_line(ink: &Ink, catalog: &crate::oduse::od::Catalog) -> String {
    let p = &catalog.provenance;
    let live = if p.models > 0 {
        format!(" · {} rows live", p.models)
    } else {
        String::new()
    };
    let unlisted = if p.unlisted > 0 {
        format!(
            " · {} in the price list with no published multiplier (not listed)",
            p.unlisted
        )
    } else {
        String::new()
    };
    let why = match (p.origin, p.error.as_deref()) {
        (crate::oduse::od::Origin::Builtin, Some(reason)) => {
            format!(
                " · offline seed {}, live list not used ({reason})",
                catalog.extracted_at
            )
        }
        (crate::oduse::od::Origin::Builtin, None) => {
            format!(" · offline seed {}", catalog.extracted_at)
        }
        _ => String::new(),
    };
    format!(
        "{}catalogue: {}{live}{unlisted}{why}{}\n",
        ink.dim,
        p.label(),
        ink.reset
    )
}
