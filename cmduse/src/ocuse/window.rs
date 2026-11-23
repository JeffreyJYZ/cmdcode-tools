// Aggregation: rows -> per-model totals -> the documented windows.
//
// Go's limits are per model and per period: 5-hour = 20% of the monthly limit,
// weekly = 50%, monthly = 100%. The monthly *period* is a subscription
// anniversary that nothing local records, so we infer it from the earliest Go
// row we have ever seen (its day-of-month) and fall back to the calendar month
// when there is no evidence. The inference is reported, never silent.
use crate::ocuse::db::Row;
use crate::ocuse::zen::Catalog;
use serde::{Deserialize, Serialize};

pub const FIVE_HOUR_SECS: i64 = 5 * 3600;
pub const WEEKLY_SECS: i64 = 7 * 86_400;
/// How far back to read when inferring the anniversary.
pub const LOOKBACK_SECS: i64 = 120 * 86_400;

#[derive(Debug, Clone, Default)]
pub struct Totals {
    pub cost: f64,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
}

impl Totals {
    /// Add one turn at `cost` — priced by the caller, which is the whole point:
    /// `row.cost_usd` is opencode's figure, always the off-peak sheet, so the
    /// dashboard prices each turn on the documented schedule instead and falls
    /// back to the recorded cost when the model carries no rates.
    pub fn add(&mut self, row: &Row, cost: f64) {
        self.cost += cost;
        self.requests += 1;
        self.input += row.input;
        self.output += row.output + row.reasoning;
        self.cache_read += row.cache_read;
    }

    pub fn tokens(&self) -> u64 {
        self.input + self.output + self.cache_read
    }
}

#[derive(Debug, Clone)]
pub struct ModelUsage {
    pub id: String,
    pub provider: String,
    pub limit: Option<f64>,
    pub month: Totals,
    pub five_hour: Totals,
    pub weekly: Totals,
}

impl ModelUsage {
    /// Fraction of the monthly limit used, when the docs give one.
    pub fn month_use(&self) -> Option<f64> {
        self.limit.filter(|l| *l > 0.0).map(|l| self.month.cost / l)
    }
}

/// Which of this model's windows is over its share of the monthly limit, if
/// any — the verdict the sidebar's flag, the watch frame and the cap
/// notification all read from. Go meters per model AND per window (5-hour =
/// 20%, weekly = 50%, monthly = 100%), so any one of them counts; the shortest
/// window wins, being the most actionable. `None` for a free/unlimited model.
pub fn over_window(model: &ModelUsage) -> Option<&'static str> {
    let limit = model.limit.filter(|l| *l > 0.0)?;
    let shares = &crate::ocuse::zen::catalog().go.window_share;
    if model.five_hour.cost > limit * shares.five_hour {
        Some("5-hour")
    } else if model.weekly.cost > limit * shares.weekly {
        Some("weekly")
    } else if model.month.cost > limit * shares.monthly {
        Some("monthly")
    } else {
        None
    }
}

/// One observed allowance change, in epoch ms. The history file is a list of
/// these; the blend reconstructs the time spans from the `from`/`to` values
/// rather than trusting a single current cap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapChange {
    pub model: String,
    pub from: f64,
    pub to: f64,
    pub at: i64,
}

/// The period's utilization picture: a blended headline plus the current-cap
/// figure it is so easily confused with. Both are percentages of a real
/// allowance, never a ceiling inferred from a ratio.
#[derive(Debug, Clone)]
pub struct CapBlend {
    /// The headline share of the time-weighted allowance, or the server's
    /// figure when no cap history exists.
    pub percent: f64,
    /// `"blended"` when spans from history were used, `"server"` otherwise.
    pub percent_source: &'static str,
    /// The endpoint's own number, carried unchanged as corroboration.
    pub server_percent: f64,
    /// The latest allowance recorded for the model the blend describes.
    pub current_cap: Option<f64>,
    /// `spend / current_cap × 100` — the separate, labelled current-cap figure.
    pub current_cap_percent: Option<f64>,
    /// The time-weighted allowance used by the blend, for pace and pro-rata.
    pub weighted_allowance: Option<f64>,
    /// The spend the two percentages are shares of.
    pub spend: f64,
    /// The model whose cap history produced this picture.
    pub model: Option<String>,
    /// Changes that fell inside the period, for the output's explanation and
    /// the top-level JSON `capChanges`.
    pub changes: Vec<CapChange>,
    /// A real signal: the local blend and the console disagree by more than a
    /// point, so a cap moved somewhere the sampled history did not see.
    pub note: Option<String>,
}

impl CapBlend {
    /// The fresh-install case: no cap history, so the server's figure is the
    /// only blend available. Every consumer labels it `percentSource: server`.
    pub fn from_server(percent: f64) -> Self {
        CapBlend {
            percent,
            percent_source: "server",
            server_percent: percent,
            current_cap: None,
            current_cap_percent: None,
            weighted_allowance: None,
            spend: 0.0,
            model: None,
            changes: Vec::new(),
            note: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Report {
    /// What the caller called this period ("calendar month", "all", "30d") for display.
    pub period_label: String,
    pub now_ms: i64,
    pub since_ms: i64,
    /// End of the period (epoch ms), resolved by the caller from its own start
    /// — see `next_month`. `None` when the period has no boundary (`--window
    /// all`); the rolling 5h/weekly windows never carry one.
    pub period_end_ms: Option<i64>,
    pub month_inferred: bool,
    /// The account's own three meters, when OpenCode Go's usage endpoint
    /// answered (`ocuse::api`). The dashboard's window rows read from here
    /// rather than from [`Self::five_hour`]/[`Self::weekly`]/[`Self::month`],
    /// because only the server's numbers agree with the console; the store's are
    /// the fallback. `None` also keeps every existing caller working.
    pub account: Option<crate::ocuse::api::Usage>,
    /// Why the account's meters are absent, when that is worth saying — a refused
    /// key, a missing one, a dead network. `None` when the endpoint answered, and
    /// also for `--no-api` (a deliberate choice is not a fault). Without it the
    /// dashboard's "estimated locally" says nothing about which it was, and only
    /// one of those is something to act on.
    pub account_error: Option<String>,
    /// Every local client the rows came from, in read order — `opencode`, `dsh`,
    /// `pi`. The dashboard names them, because a total that grew when another
    /// harness spent the same allowance must be visible, not mysterious.
    pub clients: Vec<String>,
    pub five_hour: Totals,
    pub weekly: Totals,
    pub month: Totals,
    /// Sorted by month cost, descending.
    pub models: Vec<ModelUsage>,
    /// The blended headline and its labelled current-cap companion. Set to the
    /// server's figure by [`build`], then replaced from cap history by
    /// [`apply_cap_history`] once the catalogue has been resolved.
    pub cap_blend: CapBlend,
}

/// Civil date from a Unix day number (Howard Hinnant's algorithm) — avoids a
/// date dependency for the one thing we need: a day-of-month.
fn day_of_month(epoch_secs: i64) -> u32 {
    civil(epoch_secs).2 as u32
}

pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil(epoch_secs: i64) -> (i64, i64, i64) {
    let days = epoch_secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Wall-clock now in epoch ms.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Start of the calendar month, 00:00 UTC — the predictable default, since
/// nothing local records a subscription anniversary (the console holds it).
pub fn calendar_month_start(now_ms: i64) -> i64 {
    let (year, month, _) = civil(now_ms / 1000);
    days_from_civil(year, month, 1) * 86_400_000
}

/// The same day-of-month one month later, 00:00 UTC, in epoch ms; the year
/// wraps. The day is clamped to 28 so an anniversary on the 29th–31st cannot
/// skip a month into the wrong one — the same clamp `month_start` applies, so a
/// period start it produced always has a matching end.
pub fn next_month(ms: i64) -> i64 {
    let (year, month, day) = civil(ms / 1000);
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    days_from_civil(ny, nm, day.min(28)) * 86_400_000
}

/// The same day-of-month one month *earlier*, keeping the time of day — the
/// inverse of [`next_month`] for the instants it can produce. The account API's
/// monthly `resetsAt` is an anniversary time (09:14:35, not midnight), so its
/// period start has to carry that time of day back to the previous month.
pub fn prev_month(ms: i64) -> i64 {
    let (year, month, day) = civil(ms / 1000);
    let (py, pm) = if month == 1 {
        (year - 1, 12)
    } else {
        (year, month - 1)
    };
    days_from_civil(py, pm, day.min(28)) * 86_400_000 + ms.rem_euclid(86_400_000)
}

/// Start of the billing month: the most recent occurrence of the inferred
/// anniversary day, else the first of the calendar month. Returns (start, inferred).
pub fn month_start(rows: &[Row], now_ms: i64) -> (i64, bool) {
    let now_secs = now_ms / 1000;
    // Anniversary evidence: the oldest Go row we know about (its day-of-month),
    // else the oldest row of any kind.
    let (year, month, _day) = civil(now_secs);
    let earliest_go = rows
        .iter()
        .filter(|r| r.provider == "opencode-go")
        .map(|r| r.at_ms)
        .min();
    let anniversary = earliest_go
        .or_else(|| rows.iter().map(|r| r.at_ms).min())
        .map(|ms| day_of_month(ms / 1000));
    if let Some(day_wanted) = anniversary {
        let candidate = days_from_civil(year, month, day_wanted.min(28) as i64) * 86_400;
        if candidate <= now_secs {
            return (candidate * 1000, true);
        }
        let (py, pm) = if month == 1 {
            (year - 1, 12)
        } else {
            (year, month - 1)
        };
        return (
            days_from_civil(py, pm, day_wanted.min(28) as i64) * 86_400 * 1000,
            true,
        );
    }
    // No evidence at all: calendar month.
    let current = civil(now_secs);
    let days = days_from_civil(current.0, current.1, 1);
    (days * 86_400 * 1000, false)
}

/// Build the report: window totals plus a per-model breakdown for the period.
///
/// `plan_id` selects which Go plan's per-model allowances the figures are
/// measured against (the store records no subscription, so the caller chooses);
/// `since_override` pins the period start (from `--period-start`); otherwise the
/// anniversary heuristic in [`month_start`] applies. Rows before the period are
/// anniversary evidence only — never listed — so the table and the totals agree.
pub fn build(
    rows: &[Row],
    catalog: &Catalog,
    plan_id: &str,
    now_ms: i64,
    since_override: Option<i64>,
    account: Option<&crate::ocuse::api::Usage>,
) -> Report {
    let (inferred_start, month_inferred) = month_start(rows, now_ms);
    let since_ms = since_override.unwrap_or(inferred_start);
    // The windows are cut at the *account's* bounds when it answered. Go meters a
    // 5-hour block with its own reset, a week anchored to Monday 00:00 UTC, and
    // the billing anniversary — none of which a rolling `now - length` cut
    // reproduces. Cutting locally and pairing those dollars with the server's
    // percentage put two different windows on one row: on real data the weekly
    // row read `$20.45 (0.0% of limit)`, because the store's rolling week still
    // held the previous week's spend while the server's week had just started.
    // Without an answer the rolling cuts stay — the only ones this machine knows.
    let (five_start, five_end) = match account.and_then(|a| a.rolling.reset_ms()) {
        Some(reset) => (reset - FIVE_HOUR_SECS * 1000, reset),
        None => (now_ms - FIVE_HOUR_SECS * 1000, i64::MAX),
    };
    let (week_start, week_end) = match account.and_then(|a| a.weekly.reset_ms()) {
        Some(reset) => (reset - WEEKLY_SECS * 1000, reset),
        None => (now_ms - WEEKLY_SECS * 1000, i64::MAX),
    };

    let mut report = Report {
        period_label: "calendar month".into(),
        now_ms,
        since_ms,
        period_end_ms: None,
        month_inferred: since_override.is_none() && month_inferred,
        account: None,
        account_error: None,
        clients: Vec::new(),
        five_hour: Totals::default(),
        weekly: Totals::default(),
        month: Totals::default(),
        models: Vec::new(),
        cap_blend: CapBlend::from_server(account.map(|a| a.monthly.percent).unwrap_or(0.0)),
    };
    let mut by_model: std::collections::BTreeMap<String, ModelUsage> = Default::default();

    // Which local clients these rows came from. Read before the cutting loop so a
    // client whose rows all fall outside the window is still named — the store was
    // read, and saying so beats a silently different total.
    for row in rows {
        if row.client.is_empty() {
            continue; // a hand-built row in a test names no client
        }
        if !report.clients.iter().any(|client| client == row.client) {
            report.clients.push(row.client.to_string());
        }
    }

    for row in rows {
        // The month cut applies to the month, not to the loop: the account's week
        // is anchored to Monday, which can start before a mid-week billing
        // anniversary, and dropping those rows would undercount the very window
        // the server's percentage describes.
        let in_month = row.at_ms >= since_ms;
        let in_week = row.at_ms >= week_start && row.at_ms < week_end;
        let in_five = row.at_ms >= five_start && row.at_ms < five_end;
        if !in_month && !in_week && !in_five {
            continue;
        }
        // Priced on the documented schedule, not by opencode's recorded `cost`
        // (always the off-peak sheet). Falls back to the recorded figure for a
        // model with no rate rows, so a free or unknown model still counts zero
        // and an unpriced one still counts its own cost.
        let cost = catalog
            .price(
                &row.model,
                row.at_ms,
                row.input,
                row.output,
                row.reasoning,
                row.cache_read,
                row.cache_write,
            )
            .unwrap_or(row.cost_usd);
        if in_month {
            report.month.add(row, cost);
        }
        if in_week {
            report.weekly.add(row, cost);
        }
        if in_five {
            report.five_hour.add(row, cost);
        }
        let entry = by_model
            .entry(row.model.clone())
            .or_insert_with(|| ModelUsage {
                id: row.model.clone(),
                provider: row.provider.clone(),
                limit: catalog.go_limit(plan_id, &row.model),
                month: Totals::default(),
                five_hour: Totals::default(),
                weekly: Totals::default(),
            });
        if in_month {
            entry.month.add(row, cost);
        }
        if in_week {
            entry.weekly.add(row, cost);
        }
        if in_five {
            entry.five_hour.add(row, cost);
        }
    }

    report.models = by_model.into_values().collect();
    report.models.sort_by(|a, b| {
        b.month
            .cost
            .partial_cmp(&a.month.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    report
}

/// Reconstruct the cap timeline from change entries. The first `from` is the
/// allowance in force before the first recorded change; each `to` runs until
/// the next change. `i64::MIN`/`MAX` are safe here because `weighted_allowance`
/// clips every span to the elapsed window before doing any arithmetic.
fn spans_from_changes(changes: &[&CapChange]) -> Vec<(f64, i64, i64)> {
    let mut sorted: Vec<&CapChange> = changes.to_vec();
    sorted.sort_by_key(|change| change.at);
    let Some(first) = sorted.first() else {
        return Vec::new();
    };
    let mut cap = first.from;
    let mut from = i64::MIN;
    let mut spans = Vec::new();
    for change in sorted {
        let at = change.at.div_euclid(1000);
        if cap > 0.0 && at > from {
            spans.push((cap, from, at));
        }
        cap = change.to;
        from = at;
    }
    if cap > 0.0 {
        spans.push((cap, from, i64::MAX));
    }
    spans
}

/// Name a model only when one model accounts for nearly all the period spend;
/// with several meaningful spenders the gap has no single owner. The catalogue's
/// display name is used when it has one, the id otherwise.
fn focus_label(report: &Report, model: &ModelUsage) -> String {
    let share = if report.month.cost > 0.0 {
        model.month.cost / report.month.cost
    } else {
        0.0
    };
    if share < 0.9 {
        return String::new();
    }
    crate::ocuse::catalogue::catalog()
        .go
        .models
        .iter()
        .find(|entry| entry.id == model.id)
        .map(|entry| entry.name.clone())
        .unwrap_or_else(|| model.id.clone())
}

/// Complete a report's utilization picture. The current-cap figure always comes
/// from the **published catalogue limit** of the model actually used — history
/// says when a limit moved, never what it is today — so it is filled even on a
/// fresh install with no cap history at all. History is used only to replace the
/// headline with a time-weighted blend; with no spans the endpoint's number
/// stands, but a gap between it and today's cap is itself evidence the basis
/// moved and is explained without inventing an unsampled old cap.
pub fn apply_cap_history(report: &mut Report, changes: &[CapChange]) {
    let start = report.since_ms.div_euclid(1000).max(0);
    let now = report.now_ms.div_euclid(1000).max(0);
    let in_window: Vec<CapChange> = changes
        .iter()
        .filter(|change| {
            let at = change.at.div_euclid(1000);
            at >= start && at <= now
        })
        .cloned()
        .collect();
    let server = report.cap_blend.server_percent;

    // A model whose cap moved inside the window is the subject; otherwise the
    // biggest spender that actually has a published limit. Free models publish
    // none, so they cannot supply a current-cap figure.
    let focus = report
        .models
        .iter()
        .find(|model| in_window.iter().any(|change| change.model == model.id))
        .or_else(|| {
            report
                .models
                .iter()
                .find(|model| model.limit.is_some_and(|limit| limit > 0.0))
        });
    let current_cap = focus.and_then(|model| model.limit.filter(|limit| *limit > 0.0));
    let spend = focus.map(|model| model.month.cost).unwrap_or(0.0);
    let current_cap_percent = current_cap.and_then(|cap| cmduse_core::share_of(spend, cap));

    // With history, reconstruct the timeline and compute the blend over the
    // elapsed window. The current-cap figure still comes from the catalogue
    // above, not from the last recorded `to`.
    let spans = focus
        .map(|model| {
            let model_changes: Vec<&CapChange> = changes
                .iter()
                .filter(|change| change.model == model.id)
                .collect();
            spans_from_changes(&model_changes)
        })
        .unwrap_or_default();
    let allowance = cmduse_core::weighted_allowance(&spans, start, now);

    let (percent, percent_source, weighted_allowance, note) = match allowance {
        Some(allowance) => {
            let blend = cmduse_core::share_of(spend, allowance).unwrap_or(server);
            let note = ((blend - server).abs() > 1.0).then(|| {
                format!(
                    "local blend {blend:.1}% differs from the console's {server:.0}% by more than a point; the allowance may have moved outside the sampled window"
                )
            });
            (blend, "blended", Some(allowance), note)
        }
        None => {
            // No sampled spans: the server's figure is the only blend available.
            // A real gap against today's cap means the basis moved inside the
            // window somewhere we did not sample. Say so without inventing the
            // old value, and name the model only when one dominates the spend.
            let note = match (report.account.as_ref(), current_cap_percent) {
                (Some(_), Some(today)) if (server - today).abs() > 1.0 => {
                    let label = focus
                        .map(|model| focus_label(report, model))
                        .unwrap_or_default();
                    let who = if label.is_empty() {
                        String::new()
                    } else {
                        format!(" ({label})")
                    };
                    Some(format!(
                        "the allowance changed during this period{who}; the server meters {server:.0}%, today's cap implies {today:.1}%"
                    ))
                }
                _ => None,
            };
            (server, "server", None, note)
        }
    };

    report.cap_blend = CapBlend {
        percent,
        percent_source,
        server_percent: server,
        current_cap,
        current_cap_percent,
        weighted_allowance,
        spend,
        model: focus.map(|model| model.id.clone()),
        changes: in_window,
        note,
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ocuse::db::Row;

    fn row(at_s: i64, model: &str, cost: f64) -> Row {
        Row {
            at_ms: at_s * 1000,
            provider: "opencode-go".into(),
            model: model.into(),
            cost_usd: cost,
            ..Default::default()
        }
    }

    /// An account meter with a reset instant, for the window-bound tests.
    fn meter(status: &str, percent: f64, resets_at: &str) -> crate::ocuse::api::Meter {
        crate::ocuse::api::Meter {
            status: status.into(),
            percent,
            resets_at: Some(resets_at.into()),
        }
    }

    /// ISO-8601 UTC for an epoch-seconds instant, so the meter's wire shape
    /// (`resetsAt`) is exercised rather than a pre-parsed value.
    fn iso(secs: i64) -> String {
        let rem = secs.rem_euclid(86_400);
        let (y, m, d) = civil(secs - rem);
        format!(
            "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z",
            rem / 3600,
            (rem % 3600) / 60,
            rem % 60
        )
    }

    #[test]
    fn civil_helpers_round_trip() {
        // 2026-09-27T00:00:00Z
        let secs = days_from_civil(2026, 9, 27) * 86_400;
        assert_eq!(civil(secs), (2026, 9, 27));
        assert_eq!(day_of_month(secs), 27);
    }

    #[test]
    fn next_month_keeps_the_day_and_wraps_the_year() {
        // Same day-of-month, one month later, across a year boundary.
        let dec15 = days_from_civil(2026, 12, 15) * 86_400_000;
        assert_eq!(civil(next_month(dec15) / 1000), (2027, 1, 15));
        // A calendar-month start (day 1) lands on day 1 of the next month.
        let jan1 = days_from_civil(2026, 1, 1) * 86_400_000;
        assert_eq!(civil(next_month(jan1) / 1000), (2026, 2, 1));
        // A 31st start is clamped to 28, so it cannot skip a short month.
        let jan31 = days_from_civil(2026, 1, 31) * 86_400_000;
        assert_eq!(civil(next_month(jan31) / 1000), (2026, 2, 28));
    }

    #[test]
    fn prev_month_inverts_next_month_and_keeps_the_clock() {
        // The account API's monthly reset for this subscription.
        let reset = 1_794_604_475_000; // 2026-11-13T09:14:35Z
        let start = prev_month(reset);
        assert_eq!(civil(start / 1000), (2026, 10, 13));
        assert_eq!(start % 86_400_000, reset % 86_400_000, "time of day kept");
        // One month on from the derived start is the reset's date again.
        assert_eq!(civil(next_month(start) / 1000), (2026, 11, 13));
        // Year wrap, and the day clamp that keeps a 31st from skipping a month.
        let dec13 = days_from_civil(2026, 12, 13) * 86_400_000;
        assert_eq!(civil(prev_month(dec13) / 1000), (2026, 11, 13));
        let mar31 = days_from_civil(2026, 3, 31) * 86_400_000;
        assert_eq!(civil(prev_month(mar31) / 1000), (2026, 2, 28));
    }

    #[test]
    fn windows_are_rolling_and_the_month_is_inferred() {
        let now = days_from_civil(2026, 9, 27) * 86_400 + 12 * 3600;
        let rows = vec![
            row(now - 60, "glm-5.3-flash", 1.0),          // inside 5h
            row(now - 2 * 3600, "glm-5.3-flash", 2.0),    // inside 5h + week
            row(now - 3 * 86_400, "kimi-k3", 4.0),        // inside week only
            row(now - 40 * 86_400, "glm-5.3-flash", 8.0), // previous cycle: anniversary evidence
        ];
        let catalog = crate::ocuse::zen::catalog();
        let report = build(
            &rows,
            catalog,
            crate::ocuse::zen::DEFAULT_PLAN,
            now * 1000,
            None,
            None,
        );
        assert!(
            report.month_inferred,
            "anniversary inferred from the earliest row"
        );
        assert!((report.five_hour.cost - 3.0).abs() < 1e-9);
        assert!((report.weekly.cost - 7.0).abs() < 1e-9);
        // anniversary day = 18 (40 days before the 27th), so this cycle starts Sep 18
        assert!(
            (report.month.cost - 7.0).abs() < 1e-9,
            "month cost {}",
            report.month.cost
        );
        let flash = report
            .models
            .iter()
            .find(|m| m.id == "glm-5.3-flash")
            .unwrap();
        assert_eq!(flash.limit, Some(60.0));
        assert!((flash.five_hour.cost - 3.0).abs() < 1e-9);
    }

    /// The account's own bounds decide the windows when it answered. Go's 5-hour
    /// window is a *block* with its own reset and its week starts Monday 00:00
    /// UTC, so a rolling `now - length` cut describes a different span — the bug
    /// that printed `$20.45 (0.0% of limit)` on a row whose console share had
    /// just started counting.
    #[test]
    fn the_accounts_bounds_cut_the_windows_when_it_answered() {
        let now = days_from_civil(2026, 10, 19) * 86_400 + 12 * 3600; // Mon noon UTC
        let week_reset = now + 6 * 86_400 + 12 * 3600; // next Monday 00:00
        let five_reset = now + 3 * 3600;
        let five_start = five_reset - FIVE_HOUR_SECS;
        let rows = vec![
            // Before the server's week (so outside it) but inside a rolling 7d.
            row(now - 6 * 86_400, "glm-5.3-flash", 9.0),
            // Inside the server's week but outside its 5-hour block (which
            // starts two hours back), so the two cuts are distinguishable.
            row(now - 3 * 3600, "glm-5.3-flash", 2.0),
            // Inside the server's 5-hour block.
            row(five_start + 60, "glm-5.3-flash", 1.0),
        ];
        let account = crate::ocuse::api::Usage {
            rolling: meter("ok", 6.0, &iso(five_reset)),
            weekly: meter("ok", 3.0, &iso(week_reset)),
            monthly: meter("ok", 51.0, &iso(now + 20 * 86_400)),
        };
        let report = build(
            &rows,
            crate::ocuse::zen::catalog(),
            crate::ocuse::zen::DEFAULT_PLAN,
            now * 1000,
            None,
            Some(&account),
        );
        // The rolling 7d cut would have counted the 6-day-old row ($9, so 12.0
        // here); the server's Monday week starts 12h ago and must not.
        assert!(
            (report.weekly.cost - 3.0).abs() < 1e-9,
            "weekly {}",
            report.weekly.cost
        );
        assert!(
            (report.five_hour.cost - 1.0).abs() < 1e-9,
            "5h {}",
            report.five_hour.cost
        );
        // …and the same cut applies to the per-model rows the panel pairs with.
        let flash = report
            .models
            .iter()
            .find(|m| m.id == "glm-5.3-flash")
            .unwrap();
        assert!((flash.weekly.cost - 3.0).abs() < 1e-9);
        assert!((flash.five_hour.cost - 1.0).abs() < 1e-9);
        // The month is untouched by the window cuts: it still sees every row in
        // the period, including the one the server's week excluded.
        assert!((report.month.cost - 12.0).abs() < 1e-9);
    }

    /// A fresh install has no cap history. The endpoint's number is then the
    /// only blend available, and must be carried as the server's — never
    /// repackaged as a locally computed percentage.
    #[test]
    fn an_empty_history_falls_back_to_the_server_percent() {
        let now = days_from_civil(2026, 11, 20) * 86_400 * 1000;
        let account = crate::ocuse::api::Usage {
            rolling: meter("ok", 5.0, &iso(now / 1000 + 3_600)),
            weekly: meter("ok", 40.0, &iso(now / 1000 + 7 * 86_400)),
            monthly: meter("ok", 76.0, &iso(now / 1000 + 20 * 86_400)),
        };
        let mut report = build(
            &[row(now / 1000 - 60, "glm-5.3-flash", 70.0)],
            crate::ocuse::zen::catalog(),
            crate::ocuse::zen::DEFAULT_PLAN,
            now,
            Some(now - 10 * 86_400_000),
            Some(&account),
        );
        assert_eq!(report.cap_blend.percent, 76.0);
        assert_eq!(report.cap_blend.percent_source, "server");
        apply_cap_history(&mut report, &[]);
        assert_eq!(report.cap_blend.percent, 76.0, "value unchanged");
        assert_eq!(report.cap_blend.percent_source, "server");
        assert_eq!(report.cap_blend.server_percent, 76.0);
        // The current-cap figure comes from the catalogue's published limit,
        // not from history, so it is filled even on a fresh install.
        assert_eq!(report.cap_blend.current_cap, Some(60.0));
        assert_eq!(report.cap_blend.current_cap_percent, Some(116.7));
    }

    /// Today's cap is published in the catalogue whether or not cap history has
    /// ever sampled a change. The second labelled figure must therefore be
    /// present on a real fresh-install run, not just after a recorded move.
    #[test]
    fn the_current_cap_figure_is_filled_without_history() {
        let now = 1_800_000_000_000i64;
        let mut report = build(
            &[row(now / 1000 - 60, "deepseek-v4.1-flash", 69.873)],
            crate::ocuse::zen::catalog(),
            crate::ocuse::zen::DEFAULT_PLAN,
            now,
            Some(now - 30 * 86_400_000),
            Some(&crate::ocuse::api::Usage {
                rolling: meter("ok", 1.0, &iso(now / 1000 + 3_600)),
                weekly: meter("ok", 3.0, &iso(now / 1000 + 7 * 86_400)),
                monthly: meter("ok", 76.0, &iso(now / 1000 + 20 * 86_400)),
            }),
        );
        report.cap_blend = CapBlend::from_server(76.0);
        apply_cap_history(&mut report, &[]);
        assert_eq!(
            report.cap_blend.model.as_deref(),
            Some("deepseek-v4.1-flash")
        );
        assert_eq!(
            report.cap_blend.current_cap,
            Some(100.0),
            "published catalogue limit"
        );
        assert_eq!(report.cap_blend.current_cap_percent, Some(69.9));
        // No spans: the headline stays the server's figure and says so.
        assert_eq!(report.cap_blend.percent, 76.0);
        assert_eq!(report.cap_blend.percent_source, "server");
        assert!(report.cap_blend.weighted_allowance.is_none());
        assert!(report.cap_blend.changes.is_empty());
    }

    #[test]
    fn models_sort_by_month_spend() {
        let now = days_from_civil(2026, 9, 27) * 86_400;
        let rows = vec![row(now - 60, "cheap", 0.1), row(now - 60, "pricey", 5.0)];
        let report = build(
            &rows,
            crate::ocuse::zen::catalog(),
            crate::ocuse::zen::DEFAULT_PLAN,
            now * 1000,
            None,
            None,
        );
        assert_eq!(report.models[0].id, "pricey");
    }

    /// The report names every client it read, so a total that grew because `pi`
    /// or `dsh` spent the same allowance is visible in the frame, not inferred.
    #[test]
    fn the_report_names_every_client_it_read() {
        let now = days_from_civil(2026, 9, 27) * 86_400;
        let mut rows = vec![row(now - 60, "cheap", 0.1)];
        rows[0].client = crate::stores::OPENCODE;
        let mut dsh = row(now - 60, "cheap", 0.2);
        dsh.client = crate::stores::DSH;
        let mut again = row(now - 60, "cheap", 0.3);
        again.client = crate::stores::DSH;
        rows.extend([dsh, again]);
        let report = build(
            &rows,
            crate::ocuse::zen::catalog(),
            crate::ocuse::zen::DEFAULT_PLAN,
            now * 1000,
            None,
            None,
        );
        assert_eq!(report.clients, ["opencode", "dsh"]);
    }
}
