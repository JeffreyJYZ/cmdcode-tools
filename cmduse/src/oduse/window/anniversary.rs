// The subscription anniversary heuristic, split out because it is the one guess
// in the aggregation and deserves its own comment (and its own file).
//
// Nothing local records a subscription start, so the day-of-month of the oldest
// turn this store holds stands in for it — the same inference `ocuse` makes for
// Go's billing month. It is opt-in (`--infer-anniversary`) and the report says
// when it was used.
use super::{calendar_month_start, days_from_civil};
use crate::oduse::db::Row;

/// Start of the period: the most recent occurrence of the inferred anniversary
/// day, else the first of the calendar month. Returns `(start_ms, inferred)`.
pub fn month_start(rows: &[Row], now_ms: i64) -> (i64, bool) {
    let now_secs = now_ms / 1000;
    let Some(earliest) = rows.iter().map(|r| r.at_ms).min() else {
        return (calendar_month_start(now_ms), false);
    };
    let day = day_of_month(earliest.div_euclid(86_400_000).max(0));
    let now_days = now_secs.div_euclid(86_400);
    let (year, month) = year_month(now_days);
    let candidate = days_from_civil(year, month, day);
    if candidate <= now_days {
        return (candidate * 86_400_000, true);
    }
    let (py, pm) = if month == 1 {
        (year - 1, 12)
    } else {
        (year, month - 1)
    };
    (days_from_civil(py, pm, day) * 86_400_000, true)
}

/// `(year, month)` of a Unix day number, read off the shared civil formatter so
/// the calendar has exactly one implementation in this crate.
fn year_month(days: i64) -> (i64, i64) {
    let text = cmduse_core::dates::civil_from_days(days);
    let mut parts = text.split('-');
    let year = parts.next().and_then(|y| y.parse().ok()).unwrap_or(1970);
    let month = parts.next().and_then(|m| m.parse().ok()).unwrap_or(1);
    (year, month)
}

/// Day-of-month for a Unix day number; clamped to 28 so an anniversary on the
/// 29th–31st cannot skip a short month.
fn day_of_month(days: i64) -> i64 {
    let text = cmduse_core::dates::civil_from_days(days);
    text.rsplit('-')
        .next()
        .and_then(|d| d.parse::<i64>().ok())
        .unwrap_or(1)
        .clamp(1, 28)
}
