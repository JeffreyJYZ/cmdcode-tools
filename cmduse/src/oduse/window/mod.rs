// Aggregation: rows -> per-model totals -> the plan's published windows.
//
// OpenDesign publishes its caps but exposes no per-window usage API — the daemon
// serves a wallet balance, not meters — so every window here is this machine's
// own cut of the store, and the dashboard labels it an estimate.
//
// The month is the caller's period (`--period-start`, else the calendar month,
// else an inferred subscription anniversary). The 5-hour and 7-day windows are
// rolling cuts: Go's 5-hour window is a block the server opens, and the 7-day
// window resets from the subscription start, so a local `now - length` describes
// a different span than the server's. Nothing here can know the true anchors, so
// the frame says which cut it used rather than inventing a reset instant.
//
// The calendar helpers come from `ocuse::window`, which holds this crate's only
// copy of that arithmetic — a second implementation is the drift this repo makes
// a rule against.
pub use crate::ocuse::window::{calendar_month_start, days_from_civil, next_month, now_ms};

mod anniversary;
mod totals;

pub use anniversary::month_start;
pub use totals::{window_caps, ModelUsage, Totals};

use crate::oduse::db::Row;
use crate::oduse::meter::Source;
use crate::oduse::od::{Catalog, Plan};
use crate::oduse::wallet::Wallet;

pub const FIVE_HOUR_SECS: i64 = 5 * 3600;
pub const WEEKLY_SECS: i64 = 7 * 86_400;
/// How far back to read when inferring the subscription anniversary.
pub const LOOKBACK_SECS: i64 = 120 * 86_400;

/// The three windows a plan publishes, so a caller can ask for one cap set
/// without repeating the frame's field names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Span {
    FiveHour,
    Weekly,
    Month,
}

impl Span {
    pub fn label(self) -> &'static str {
        match self {
            Span::FiveHour => "5-hour",
            Span::Weekly => "weekly",
            Span::Month => "monthly",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Report {
    /// What the caller called this period ("calendar month", "all", "30d").
    pub period_label: String,
    pub plan_id: String,
    pub now_ms: i64,
    pub since_ms: i64,
    /// End of the period (epoch ms), resolved by the caller from its own start.
    /// `None` when the period has no boundary (`--window all`).
    pub period_end_ms: Option<i64>,
    /// Whether that span is an anchor the **plan** itself uses: a pinned
    /// `--period-start`, an explicit `--since`, or the inferred subscription
    /// anniversary. The default calendar month is not — the plan's cycle is the
    /// anniversary — so the frame refuses to print an elapsed share from it.
    pub period_anchored: bool,
    pub month_inferred: bool,
    /// The daemon's wallet snapshot, when it answered (`oduse::wallet`). It is a
    /// balance, not a window meter, so it prints beside the windows rather than
    /// replacing them.
    pub wallet: Option<Wallet>,
    /// Why the wallet is absent, when that is worth saying — a dead session
    /// cookie, a closed app, an expired control key. `None` when it answered,
    /// and for `--no-wallet`.
    pub wallet_error: Option<String>,
    /// Which meter produced `wallet`: `api` or `daemon`; `null` when absent.
    pub wallet_source: Option<Source>,
    /// The account's own window meters (`billing/snapshot`), when a session
    /// cookie answered. These win over the local cuts below: they are the
    /// figures the console shows, anchored at the server's own `resetsAt`.
    pub snapshot: Option<crate::oduse::snapshot::Snapshot>,
    /// Why the snapshot did not answer. `None` when it did and when no cookie
    /// was supplied — in the latter case the local estimate is the only source.
    pub snapshot_error: Option<String>,
    /// The stores whose rows are in this report (`app`, `opencode`), in read
    /// order. The header names them, so a total that grew cannot look like drift.
    pub sources: Vec<&'static str>,
    /// One line per store that could not be read, or a note the figures need.
    pub notes: Vec<String>,
    pub five_hour: Totals,
    pub weekly: Totals,
    pub month: Totals,
    /// Sorted by month credits, descending.
    pub models: Vec<ModelUsage>,
}

/// Which window is over its published cap, if any — the verdict the watch loop's
/// cap notification reads. OpenDesign caps the plan rather than a model, so this
/// is one answer per window; the shortest window wins, being the most actionable.
/// `>=`, so a window sitting exactly on its cap is the same verdict the frame's
/// `LIMIT EXCEEDED` flag prints.
///
/// The cap is the one [`window_caps`] picks for that window — the stricter set
/// the models in it actually draw on, never the plan's loosest.
pub fn over_window(report: &Report, plan: &Plan) -> Option<&'static str> {
    let caps = |span: Span| window_caps(&report.models, plan, span);
    if let Some(cap) = caps(Span::FiveHour).chosen.five_hour_usd {
        if report.five_hour.credits >= cap {
            return Some(Span::FiveHour.label());
        }
    }
    if let Some(cap) = caps(Span::Weekly).chosen.weekly_usd {
        if report.weekly.credits >= cap {
            return Some(Span::Weekly.label());
        }
    }
    if report.month.credits >= caps(Span::Month).chosen.monthly_usd {
        return Some(Span::Month.label());
    }
    None
}

/// Build the report: window totals plus a per-model breakdown for the period.
pub fn build(
    rows: &[Row],
    catalog: &Catalog,
    plan_id: &str,
    now_ms: i64,
    since_override: Option<i64>,
) -> Report {
    let (inferred_start, month_inferred) = month_start(rows, now_ms);
    let since_ms = since_override.unwrap_or(inferred_start);
    let five_start = now_ms - FIVE_HOUR_SECS * 1000;
    let week_start = now_ms - WEEKLY_SECS * 1000;

    let mut report = Report {
        period_label: "calendar month".into(),
        plan_id: plan_id.to_string(),
        now_ms,
        since_ms,
        period_end_ms: None,
        period_anchored: false,
        month_inferred: since_override.is_none() && month_inferred,
        sources: Vec::new(),
        notes: Vec::new(),
        wallet: None,
        wallet_error: None,
        wallet_source: None,
        snapshot: None,
        snapshot_error: None,
        five_hour: Totals::default(),
        weekly: Totals::default(),
        month: Totals::default(),
        models: Vec::new(),
    };
    let mut by_model: std::collections::BTreeMap<String, ModelUsage> = Default::default();

    for row in rows {
        let in_month = row.at_ms >= since_ms;
        let in_week = row.at_ms >= week_start;
        let in_five = row.at_ms >= five_start;
        if !in_month && !in_week && !in_five {
            continue;
        }
        // Priced from the catalogue, with cache reads and the recorded cost as
        // the fallback — one rule, shared by every report (`oduse::price`).
        let priced = crate::oduse::price::row_cost(row, catalog);
        if in_month {
            report.month.add_price(row, priced);
        }
        if in_week {
            report.weekly.add_price(row, priced);
        }
        if in_five {
            report.five_hour.add_price(row, priced);
        }
        let entry = by_model
            .entry(row.model.clone())
            .or_insert_with(|| ModelUsage {
                id: row.model.clone(),
                multiplier: catalog.multiplier(&row.model),
                priced: priced.priced,
                month: Totals::default(),
                five_hour: Totals::default(),
                weekly: Totals::default(),
            });
        entry.priced |= priced.priced;
        if in_month {
            entry.month.add_price(row, priced);
        }
        if in_week {
            entry.weekly.add_price(row, priced);
        }
        if in_five {
            entry.five_hour.add_price(row, priced);
        }
    }

    report.models = by_model.into_values().collect();
    report.models.sort_by(|a, b| {
        b.month
            .credits
            .total_cmp(&a.month.credits)
            .then_with(|| a.id.cmp(&b.id))
    });
    report
}
