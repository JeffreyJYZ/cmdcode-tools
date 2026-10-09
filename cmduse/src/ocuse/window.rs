// Aggregation: rows -> per-model totals -> the documented windows.
//
// Go's limits are per model and per period: 5-hour = 20% of the monthly limit,
// weekly = 50%, monthly = 100%. The monthly *period* is a subscription
// anniversary that nothing local records, so we infer it from the earliest Go
// row we have ever seen (its day-of-month) and fall back to the calendar month
// when there is no evidence. The inference is reported, never silent.
use crate::ocuse::db::Row;
use crate::ocuse::zen::Catalog;

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
    pub fn add(&mut self, row: &Row) {
        self.cost += row.cost_usd;
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
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

#[derive(Debug, Clone)]
pub struct Report {
    /// What the caller called this period ("calendar month", "all", "30d") for display.
    pub period_label: String,
    pub now_ms: i64,
    pub since_ms: i64,
    pub month_inferred: bool,
    pub five_hour: Totals,
    pub weekly: Totals,
    pub month: Totals,
    /// Sorted by month cost, descending.
    pub models: Vec<ModelUsage>,
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
) -> Report {
    let (inferred_start, month_inferred) = month_start(rows, now_ms);
    let since_ms = since_override.unwrap_or(inferred_start);
    let five_cut = now_ms - FIVE_HOUR_SECS * 1000;
    let week_cut = now_ms - WEEKLY_SECS * 1000;

    let mut report = Report {
        period_label: "calendar month".into(),
        now_ms,
        since_ms,
        month_inferred: since_override.is_none() && month_inferred,
        five_hour: Totals::default(),
        weekly: Totals::default(),
        month: Totals::default(),
        models: Vec::new(),
    };
    let mut by_model: std::collections::BTreeMap<String, ModelUsage> = Default::default();

    for row in rows {
        if row.at_ms < since_ms {
            continue; // before the period: evidence for the anniversary only
        }
        report.month.add(row);
        if row.at_ms >= week_cut {
            report.weekly.add(row);
        }
        if row.at_ms >= five_cut {
            report.five_hour.add(row);
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
        entry.month.add(row);
        if row.at_ms >= week_cut {
            entry.weekly.add(row);
        }
        if row.at_ms >= five_cut {
            entry.five_hour.add(row);
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

    #[test]
    fn civil_helpers_round_trip() {
        // 2026-09-27T00:00:00Z
        let secs = days_from_civil(2026, 9, 27) * 86_400;
        assert_eq!(civil(secs), (2026, 9, 27));
        assert_eq!(day_of_month(secs), 27);
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
            &catalog,
            crate::ocuse::zen::DEFAULT_PLAN,
            now * 1000,
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

    #[test]
    fn models_sort_by_month_spend() {
        let now = days_from_civil(2026, 9, 27) * 86_400;
        let rows = vec![row(now - 60, "cheap", 0.1), row(now - 60, "pricey", 5.0)];
        let report = build(
            &rows,
            &crate::ocuse::zen::catalog(),
            crate::ocuse::zen::DEFAULT_PLAN,
            now * 1000,
            None,
        );
        assert_eq!(report.models[0].id, "pricey");
    }
}
