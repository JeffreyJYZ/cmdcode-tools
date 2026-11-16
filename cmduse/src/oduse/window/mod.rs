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

pub use anniversary::month_start;

use crate::oduse::db::Row;
use crate::oduse::od::{Catalog, Plan};
use crate::oduse::wallet::Wallet;

pub const FIVE_HOUR_SECS: i64 = 5 * 3600;
pub const WEEKLY_SECS: i64 = 7 * 86_400;
/// How far back to read when inferring the subscription anniversary.
pub const LOOKBACK_SECS: i64 = 120 * 86_400;

#[derive(Debug, Clone, Default)]
pub struct Totals {
    /// The plan's own unit: list-price dollars x each model's multiplier.
    pub credits: f64,
    /// List-price dollars, so the estimate's basis is visible.
    pub cost: f64,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
}

impl Totals {
    fn add(&mut self, row: &Row, cost: f64, credits: f64) {
        self.credits += credits;
        self.cost += cost;
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
    }

    pub fn tokens(&self) -> u64 {
        self.input + self.output
    }
}

#[derive(Debug, Clone)]
pub struct ModelUsage {
    pub id: String,
    pub multiplier: f64,
    /// False when the catalogue carries no rate for this model: it still counts
    /// requests and tokens, and its credits are absent rather than zero.
    pub priced: bool,
    pub month: Totals,
    pub five_hour: Totals,
    pub weekly: Totals,
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
    pub month_inferred: bool,
    /// The daemon's wallet snapshot, when it answered (`oduse::wallet`). It is a
    /// balance, not a window meter, so it prints beside the windows rather than
    /// replacing them.
    pub wallet: Option<Wallet>,
    /// Why the wallet is absent, when that is worth saying — a closed app, an
    /// expired control key. `None` when it answered, and for `--no-wallet`.
    pub wallet_error: Option<String>,
    pub five_hour: Totals,
    pub weekly: Totals,
    pub month: Totals,
    /// Sorted by month credits, descending.
    pub models: Vec<ModelUsage>,
}

/// Which window is over its published cap, if any — the verdict the watch loop's
/// cap notification reads. OpenDesign caps the plan rather than a model, so this
/// is one account-wide answer; the shortest window wins, being the most
/// actionable.
pub fn over_window(report: &Report, plan: &Plan) -> Option<&'static str> {
    if let Some(cap) = plan.five_hour_usd {
        if report.five_hour.credits > cap {
            return Some("5-hour");
        }
    }
    if let Some(cap) = plan.weekly_usd {
        if report.weekly.credits > cap {
            return Some("weekly");
        }
    }
    if report.month.credits > plan.monthly_usd {
        return Some("monthly");
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
        month_inferred: since_override.is_none() && month_inferred,
        wallet: None,
        wallet_error: None,
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
        // Priced from the catalogue, not from the store: the app records tokens
        // and no money, so the rate table is the only basis there is.
        let cost = catalog
            .price(&row.model, row.input, row.output)
            .unwrap_or(0.0);
        let credits = cost * catalog.multiplier(&row.model);
        if in_month {
            report.month.add(row, cost, credits);
        }
        if in_week {
            report.weekly.add(row, cost, credits);
        }
        if in_five {
            report.five_hour.add(row, cost, credits);
        }
        let entry = by_model
            .entry(row.model.clone())
            .or_insert_with(|| ModelUsage {
                id: row.model.clone(),
                multiplier: catalog.multiplier(&row.model),
                priced: catalog.model(&row.model).is_some(),
                month: Totals::default(),
                five_hour: Totals::default(),
                weekly: Totals::default(),
            });
        if in_month {
            entry.month.add(row, cost, credits);
        }
        if in_week {
            entry.weekly.add(row, cost, credits);
        }
        if in_five {
            entry.five_hour.add(row, cost, credits);
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
