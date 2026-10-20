// Aggregation: rows -> per-model totals -> the plan's own windows.
//
// Two independent sources, and they answer different questions:
//
// * the **meters** (`arkcli usage plan`) are authoritative — the control plane's
//   own used/quota/reset for 5h, weekly and monthly (and daily, on media), and
//   the only view that can see traffic from another machine;
// * the **store** (opencode.db) is this machine's rows, which give per-model
//   attribution and a reconciliation against the coefficients.
//
// Window bounds come from the meters when they answered: ARK's 5h is a block
// that starts at the cycle's first request, the week is Monday 00:00, and the
// month is the subscription anniversary — a rolling `now - length` cut
// reproduces none of them. Without an answer the rolling cuts remain, labelled
// as the local estimate they are.
use crate::arkuse::api::Usage;
use crate::arkuse::ark::Catalog;
use crate::arkuse::db::Row;

pub const FIVE_HOUR_SECS: i64 = 5 * 3600;
pub const DAY_SECS: i64 = 86_400;
pub const WEEKLY_SECS: i64 = 7 * 86_400;
/// How far back to read when inferring the anniversary.
pub const LOOKBACK_SECS: i64 = 120 * 86_400;

#[derive(Debug, Clone, Default)]
pub struct Totals {
    /// AFP — the plan's own currency. Never dollars, and never the store's
    /// `cost`: opencode records no AFP at all.
    pub afp: f64,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// The earliest row folded in — what a rolling window's next reset derives
    /// from (oldest request + window length). Never a fabricated `now + length`.
    pub oldest_ms: Option<i64>,
}

impl Totals {
    /// Add one turn at the AFP the catalogue computed for it. `None` (an
    /// unknown model) counts the request and its tokens but no AFP, rather than
    /// inventing a coefficient.
    pub fn add(&mut self, row: &Row, afp: Option<f64>) {
        self.afp += afp.unwrap_or(0.0);
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
        self.cache_read += row.cache_read;
        self.cache_write += row.cache_write;
        self.oldest_ms = Some(self.oldest_ms.map_or(row.at_ms, |at| at.min(row.at_ms)));
    }

    pub fn tokens(&self) -> u64 {
        self.input + self.output + self.cache_read
    }
}

#[derive(Debug, Clone)]
pub struct ModelUsage {
    pub id: String,
    pub provider: String,
    /// The coefficient in force for the period (promo applied).
    pub coef: f64,
    pub month: Totals,
    pub five_hour: Totals,
    pub weekly: Totals,
}

#[derive(Debug, Clone)]
pub struct Report {
    pub period_label: String,
    pub now_ms: i64,
    pub since_ms: i64,
    pub period_end_ms: Option<i64>,
    pub month_inferred: bool,
    /// The control plane's meters, when `arkcli` answered.
    pub account: Option<Usage>,
    /// Why the meters are absent, when that is worth saying (`--no-api` is a
    /// deliberate choice, not a fault).
    pub account_error: Option<String>,
    /// The tier the figures are measured against (explicit `--plan`, else the
    /// profile's own `plan_tier`, else the catalogue default).
    pub tier: String,
    /// `arkcli` profile the meters came from, for the header.
    pub profile: Option<String>,
    /// The server offset the account's windows are cut in (seconds east of UTC).
    /// Period bounds print in that offset, never in a guessed local zone.
    pub offset_secs: i64,
    pub five_hour: Totals,
    pub weekly: Totals,
    pub month: Totals,
    /// Present only when the endpoint returned a daily window (media workloads;
    /// a text-only plan exposes 5h/weekly/monthly).
    pub daily: Option<Totals>,
    /// Sorted by month AFP, descending.
    pub models: Vec<ModelUsage>,
}

impl Report {
    /// AFP per request over the 5-hour window — the meter's figure divided by
    /// this store's request count. Fresh enough to be meaningful, and the
    /// number the capacity questions are built on.
    pub fn afp_per_request(&self) -> Option<f64> {
        let account = self.account.as_ref()?;
        let requests = self.five_hour.requests;
        (requests > 0).then(|| account.five_hour.used / requests as f64)
    }

    /// Meter vs computed AFP over the 5-hour window, as a signed percentage of
    /// the meter. A few percent is normal (a request still in flight, another
    /// machine on the same key); a large gap means an unmodelled item (media or
    /// Harness) or traffic this store cannot see.
    pub fn reconcile(&self) -> Option<f64> {
        let account = self.account.as_ref()?;
        if account.five_hour.used <= 0.0 || self.five_hour.afp <= 0.0 {
            return None;
        }
        Some((self.five_hour.afp - account.five_hour.used) / account.five_hour.used * 100.0)
    }

    /// Burn implied by the 5h window, in AFP/day: what the cycle's current pace
    /// would consume over a day. `None` before the block has any use.
    pub fn burn_per_day(&self) -> Option<f64> {
        let account = self.account.as_ref()?;
        (account.five_hour.used > 0.0).then(|| account.five_hour.used / 5.0 * 24.0)
    }

    /// The plan's own quota for a window: its monthly AFP times the catalogue's
    /// share of it. ARK publishes both, so the local estimate can print the same
    /// pair the console does — medium's 10,000 / 35,000 / 100,000 AFP are exactly
    /// what its meters reported on 2026-10-20.
    pub fn window_quota(&self, catalog: &Catalog, share: f64) -> Option<f64> {
        catalog.plan(&self.tier).map(|plan| plan.afp * share)
    }

    /// When a locally cut window turns over: its oldest in-window row plus the
    /// window's length, the same derivation the Go side uses. `None` before the
    /// window has rows — `now + length` is not a reset the data supports.
    pub fn rolling_reset(&self, totals: &Totals, dur_secs: i64) -> Option<i64> {
        totals.oldest_ms.map(|at| at + dur_secs * 1000)
    }
}

/// Civil date from a Unix day number (Howard Hinnant's algorithm) — no date
/// dependency for the day-of-month the anniversary needs.
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
    let days = epoch_secs.div_euclid(DAY_SECS);
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

/// Start of the calendar month, 00:00 UTC — the predictable default when no
/// meter names the anniversary.
pub fn calendar_month_start(now_ms: i64) -> i64 {
    let (year, month, _) = civil(now_ms / 1000);
    days_from_civil(year, month, 1) * 86_400_000
}

/// The same day-of-month one month later, 00:00 UTC, in epoch ms; the year
/// wraps and the day is clamped to 28 so an anniversary on the 29th–31st cannot
/// skip a month.
pub fn next_month(ms: i64) -> i64 {
    let (year, month, day) = civil(ms / 1000);
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    days_from_civil(ny, nm, day.min(28)) * 86_400_000
}

/// The subscription month's start from the meter's own reset instant.
///
/// ARK's monthly reset is the last second of the anniversary day
/// (`2026-11-19T23:59:59+08:00`), so the cycle starts at 00:00 on that
/// day-of-month in the previous month, **in the reset's own offset** — the
/// server speaks +08:00, and bucketing its instant as UTC would put the boundary
/// eight hours off.
pub fn month_start_before(reset_ms: i64, offset_secs: i64) -> i64 {
    let local = reset_ms + offset_secs * 1000;
    let (year, month, day) = civil(local.div_euclid(1000));
    let (py, pm) = if month == 1 {
        (year - 1, 12)
    } else {
        (year, month - 1)
    };
    days_from_civil(py, pm, day.min(28)) * 86_400_000 - offset_secs * 1000
}

/// Is `at_ms` on or before the end of the `YYYY-MM-DD` day? Used for promo
/// coefficients, which the docs publish as dates.
pub fn before_day_end(at_ms: i64, day: &str) -> bool {
    let mut parts = day.split('-');
    let (Some(y), Some(m), Some(d)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let (Ok(y), Ok(m), Ok(d)) = (y.parse::<i64>(), m.parse::<i64>(), d.parse::<i64>()) else {
        return false;
    };
    let end = (days_from_civil(y, m, d) + 1) * 86_400_000;
    at_ms < end
}

/// Start of the billing month from the first plan request, else the calendar
/// month. Returns `(start, inferred)`.
pub fn month_start(rows: &[Row], now_ms: i64) -> (i64, bool) {
    let now_secs = now_ms / 1000;
    let (year, month, _) = civil(now_secs);
    if let Some(ms) = rows.iter().map(|r| r.at_ms).min() {
        let wanted = day_of_month(ms / 1000).min(28) as i64;
        let candidate = days_from_civil(year, month, wanted) * DAY_SECS;
        if candidate <= now_secs {
            return (candidate * 1000, true);
        }
        let (py, pm) = if month == 1 {
            (year - 1, 12)
        } else {
            (year, month - 1)
        };
        return (days_from_civil(py, pm, wanted) * DAY_SECS * 1000, true);
    }
    (days_from_civil(year, month, 1) * DAY_SECS * 1000, false)
}

/// Build the report: window totals plus a per-model breakdown for the period.
pub fn build(
    rows: &[Row],
    catalog: &Catalog,
    plan_id: &str,
    now_ms: i64,
    since_override: Option<i64>,
    account: Option<&Usage>,
) -> Report {
    let (inferred_start, month_inferred) = month_start(rows, now_ms);
    let since_ms = since_override.unwrap_or(inferred_start);
    // Cut at the meter's own bounds when it answered. ARK's 5-hour window is a
    // block that begins at the cycle's first request, the week starts Monday
    // 00:00 in the server's offset, and the month is the anniversary — none of
    // which a rolling cut reproduces.
    let (five_start, five_end) = match account.and_then(|a| a.five_hour.reset_ms()) {
        Some(reset) => (reset - FIVE_HOUR_SECS * 1000, reset),
        None => (now_ms - FIVE_HOUR_SECS * 1000, i64::MAX),
    };
    let (week_start, week_end) = match account.and_then(|a| a.weekly.reset_ms()) {
        Some(reset) => (reset - WEEKLY_SECS * 1000, reset),
        None => (now_ms - WEEKLY_SECS * 1000, i64::MAX),
    };
    // Only media and Harness plans expose a daily window; text-only plans answer
    // no `daily` period at all, so the row stays absent rather than reading zero.
    let day_bounds = account
        .and_then(|a| a.daily.as_ref())
        .and_then(|m| m.reset_ms())
        .map(|reset| (reset - DAY_SECS * 1000, reset));

    let mut report = Report {
        period_label: "calendar month".into(),
        now_ms,
        since_ms,
        period_end_ms: None,
        month_inferred: since_override.is_none() && month_inferred,
        account: None,
        account_error: None,
        tier: plan_id.to_string(),
        profile: account.map(|a| a.profile.clone()),
        offset_secs: account.map_or(0, |a| a.monthly.offset_secs()),
        five_hour: Totals::default(),
        weekly: Totals::default(),
        month: Totals::default(),
        daily: day_bounds.map(|_| Totals::default()),
        models: Vec::new(),
    };
    let mut by_model: std::collections::BTreeMap<String, ModelUsage> = Default::default();

    for row in rows {
        let in_month = row.at_ms >= since_ms;
        let in_week = row.at_ms >= week_start && row.at_ms < week_end;
        let in_five = row.at_ms >= five_start && row.at_ms < five_end;
        let in_day = day_bounds.is_some_and(|(start, end)| row.at_ms >= start && row.at_ms < end);
        if !in_month && !in_week && !in_five && !in_day {
            continue;
        }
        let afp = catalog.afp(&row.model, row.at_ms, row.input, row.cache_read, row.output);
        if in_month {
            report.month.add(row, afp);
        }
        if in_day {
            report
                .daily
                .get_or_insert_with(Totals::default)
                .add(row, afp);
        }
        if in_week {
            report.weekly.add(row, afp);
        }
        if in_five {
            report.five_hour.add(row, afp);
        }
        let coef = catalog
            .models
            .iter()
            .find(|m| m.id == row.model)
            .map(|m| crate::arkuse::ark::effective_coef(m, row.at_ms))
            .unwrap_or(0.0);
        let entry = by_model
            .entry(row.model.clone())
            .or_insert_with(|| ModelUsage {
                id: row.model.clone(),
                provider: row.provider.clone(),
                coef,
                month: Totals::default(),
                five_hour: Totals::default(),
                weekly: Totals::default(),
            });
        if in_month {
            entry.month.add(row, afp);
        }
        if in_week {
            entry.weekly.add(row, afp);
        }
        if in_five {
            entry.five_hour.add(row, afp);
        }
    }

    report.models = by_model.into_values().collect();
    report.models.sort_by(|a, b| {
        b.month
            .afp
            .partial_cmp(&a.month.afp)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arkuse::db::Row;

    fn row(at_s: i64, model: &str) -> Row {
        Row {
            at_ms: at_s * 1000,
            provider: "agent-plan".into(),
            model: model.into(),
            input: 10_000,
            ..Default::default()
        }
    }

    fn meter(percent: f64, used: f64, resets_at: &str) -> crate::arkuse::api::Meter {
        crate::arkuse::api::Meter::from_parts("ok", percent, used, 0.0, Some(resets_at), None)
    }

    #[test]
    fn civil_helpers_round_trip() {
        let secs = days_from_civil(2026, 9, 27) * 86_400;
        assert_eq!(civil(secs), (2026, 9, 27));
        assert_eq!(day_of_month(secs), 27);
    }

    /// The server's monthly reset is the last second of the anniversary day in
    /// +08:00, so the cycle starts at 00:00 on that day-of-month one month
    /// earlier *in that offset* — not eight hours off, and not 23:59:59.
    #[test]
    fn month_start_follows_the_servers_anniversary_and_offset() {
        // 2026-11-19T23:59:59+08:00
        let reset = (days_from_civil(2026, 11, 19) * 86_400 + 23 * 3600 + 59 * 60 + 59) * 1000
            - 8 * 3600 * 1000;
        let start = month_start_before(reset, 8 * 3600);
        let local = (start + 8 * 3600 * 1000) / 1000;
        assert_eq!(civil(local), (2026, 10, 19), "00:00 on the 19th, +08:00");
        assert_eq!(local.rem_euclid(DAY_SECS), 0);
    }

    #[test]
    fn promo_dates_end_at_the_days_close() {
        let day = days_from_civil(2026, 12, 30) * 86_400_000;
        assert!(before_day_end(day + 3_600_000, "2026-12-30"));
        assert!(!before_day_end(day + 86_400_000, "2026-12-30"));
    }

    #[test]
    fn the_meters_bounds_cut_the_windows_when_they_answered() {
        // Mon 2026-10-19 12:00 UTC = 20:00 +08:00.
        let now = days_from_civil(2026, 10, 19) * 86_400 + 12 * 3600;
        let account = crate::arkuse::api::Usage {
            // Reset at 23:00 +08:00 the same evening: the block is now-2h..+3h.
            five_hour: meter(6.0, 600.0, "2026-10-19T23:00:00+08:00"),
            daily: None,
            // Monday 00:00 +08:00 = Sunday 16:00 UTC.
            weekly: meter(3.0, 1_050.0, "2026-10-26T00:00:00+08:00"),
            monthly: meter(51.0, 51_000.0, "2026-11-19T23:59:59+08:00"),
            tier: Some("medium".into()),
            profile: "agent-plan_cn-beijing_medium".into(),
        };
        let rows = vec![
            // Eight days back: before the server's week, inside a rolling 7d.
            row(now - 8 * 86_400, "deepseek-v4.1-flash"),
            // Six hours back: inside the Monday week, before the 5-hour block.
            row(now - 6 * 3600, "deepseek-v4.1-flash"),
            // One minute back: inside the block.
            row(now - 60, "deepseek-v4.1-flash"),
        ];
        let catalog = crate::arkuse::ark::catalog();
        let month_start = days_from_civil(2026, 10, 1) * 86_400;
        let report = build(
            &rows,
            &catalog,
            "medium",
            now * 1000,
            Some(month_start * 1000),
            Some(&account),
        );
        assert_eq!(report.five_hour.requests, 1, "only the in-block row");
        assert_eq!(report.weekly.requests, 2, "the block plus six hours back");
        assert_eq!(report.month.requests, 3, "all of them inside October");
        assert!(report.five_hour.afp > 0.0);
    }

    #[test]
    fn a_rolling_window_borrows_its_boundary_from_its_oldest_row() {
        // Without a meter the cut is `now - length`, so the next turnover is the
        // oldest row inside it plus the length — the same derivation the Go side
        // uses. `now + length` would be a fabricated countdown.
        let now = days_from_civil(2026, 10, 19) * 86_400;
        let rows = vec![
            row(now - 4 * 3600, "deepseek-v4.1-flash"),
            row(now - 60, "deepseek-v4.1-flash"),
        ];
        let catalog = crate::arkuse::ark::catalog();
        let report = build(&rows, &catalog, "medium", now * 1000, None, None);
        assert_eq!(report.five_hour.requests, 2);
        assert_eq!(report.five_hour.oldest_ms, Some((now - 4 * 3600) * 1000));
        assert_eq!(
            report.rolling_reset(&report.five_hour, FIVE_HOUR_SECS),
            Some((now + 3600) * 1000),
            "four hours of the block already spent"
        );
        assert_eq!(
            report.window_quota(&catalog, catalog.windows.five_hour),
            Some(10_000.0),
            "medium's published 5-hour split"
        );
        assert_eq!(
            report.rolling_reset(&Totals::default(), FIVE_HOUR_SECS),
            None
        );
    }

    #[test]
    fn a_daily_meter_gets_its_own_cut_and_a_text_plan_has_none() {
        // Mon 2026-10-19 12:00 UTC.
        let now = days_from_civil(2026, 10, 19) * 86_400 + 12 * 3600;
        let account = crate::arkuse::api::Usage {
            five_hour: meter(6.0, 600.0, "2026-10-19T23:00:00+08:00"),
            // 07:00 UTC: the day block is 07:00 yesterday .. 07:00 today.
            daily: Some(meter(1.0, 100.0, "2026-10-19T15:00:00+08:00")),
            weekly: meter(3.0, 1_050.0, "2026-10-26T00:00:00+08:00"),
            monthly: meter(51.0, 51_000.0, "2026-11-19T23:59:59+08:00"),
            tier: Some("medium".into()),
            profile: "agent-plan_cn-beijing_medium".into(),
        };
        let rows = vec![
            row(now - 10 * 3600, "deepseek-v4.1-flash"), // 02:00 UTC, inside
            row(now - 3600, "deepseek-v4.1-flash"),      // 11:00 UTC, after the cut
        ];
        let catalog = crate::arkuse::ark::catalog();
        let report = build(&rows, &catalog, "medium", now * 1000, None, Some(&account));
        assert_eq!(report.daily.expect("media plan exposes a day").requests, 1);
        // The same rows without a daily meter: the row stays absent, never zero.
        let mut text_only = account;
        text_only.daily = None;
        let report = build(
            &rows,
            &catalog,
            "medium",
            now * 1000,
            None,
            Some(&text_only),
        );
        assert!(report.daily.is_none());
    }

    #[test]
    fn models_sort_by_month_afp() {
        let now = days_from_civil(2026, 9, 27) * 86_400;
        let rows = vec![
            row(now - 60, "glm-5.3-flash"),
            row(now - 60, "deepseek-v4.1-flash"),
        ];
        let catalog = crate::arkuse::ark::catalog();
        let report = build(&rows, &catalog, "medium", now * 1000, None, None);
        assert_eq!(report.models[0].id, "deepseek-v4.1-flash", "2.5 > 0.5");
    }

    #[test]
    fn an_unknown_model_counts_a_request_but_no_afp() {
        let now = days_from_civil(2026, 9, 27) * 86_400;
        let rows = vec![row(now - 60, "not-a-model")];
        let catalog = crate::arkuse::ark::catalog();
        let report = build(&rows, &catalog, "medium", now * 1000, None, None);
        assert_eq!(report.month.requests, 1);
        assert_eq!(report.month.afp, 0.0);
    }
}
