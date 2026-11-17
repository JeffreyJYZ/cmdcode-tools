// The aggregation: which rows each window keeps, the credit maths, and the one
// ordering rule (biggest spender first).
use super::fixture::{catalog, plan, row, NOW_MS};
use crate::oduse::od;
use crate::oduse::window::{build, over_window, FIVE_HOUR_SECS, WEEKLY_SECS};

fn day() -> i64 {
    86_400_000
}

#[test]
fn the_windows_are_rolling_and_the_month_is_the_pinned_period() {
    let now = NOW_MS;
    let rows = vec![
        row(now - 60_000, "deepseek-v4.1-flash", 1_000_000, 0), // inside 5h: $0.15, 0.075 credits
        row(now - 2 * 3_600_000, "deepseek-v4.1-flash", 1_000_000, 0), // inside 5h + week
        row(now - 3 * day(), "glm-5.3-flash", 1_000_000, 0),    // inside week only
        row(now - 4 * day(), "kimi-k2.7-code", 1_000_000, 0),   // inside month only
        row(now - 40 * day(), "glm-5.3-flash", 1_000_000, 0),   // previous cycle
    ];
    let since = crate::oduse::window::calendar_month_start(now);
    let report = build(&rows, &catalog(), od::DEFAULT_PLAN, now, Some(since));
    assert!(
        (report.five_hour.credits - 0.15).abs() < 1e-9,
        "{:?}",
        report.five_hour
    );
    // The week also holds the 3-day-old GLM turn ($0.15) and the 4-day-old Kimi
    // one ($0.95) — inside 7 days, outside 5 hours.
    assert!(
        (report.weekly.credits - 1.25).abs() < 1e-9,
        "{:?}",
        report.weekly
    );
    // The month keeps every row at or after its pinned start, and the previous
    // cycle's row is the one it must not.
    assert_eq!(report.month.requests, 4, "{:?}", report.month);
    assert!(!report.month_inferred, "a pinned start is not an inference");
}

#[test]
fn an_inferred_anniversary_is_reported() {
    let now = crate::oduse::window::calendar_month_start(NOW_MS) + 20 * day() + 12 * 3_600_000;
    let rows = vec![row(now - 40 * day(), "glm-5.3-flash", 1_000_000, 0)];
    let report = build(&rows, &catalog(), od::DEFAULT_PLAN, now, None);
    assert!(report.month_inferred, "the anniversary was inferred");
    // The inferred start is midnight UTC on the anniversary day, in the past.
    assert_eq!(report.since_ms % day(), 0, "{:?}", report.since_ms);
    assert!(report.since_ms <= now);
}

#[test]
fn a_window_over_its_published_cap_says_which() {
    let now = NOW_MS;
    let rows = vec![row(now - 60_000, "kimi-k2.7-code", 100_000_000, 0)];
    let since = crate::oduse::window::calendar_month_start(now);
    let report = build(&rows, &catalog(), od::DEFAULT_PLAN, now, Some(since));
    // $95 list x1 = $95 inside a 5-hour cap of $18, so the shortest window wins.
    assert_eq!(over_window(&report, &plan("go")), Some("5-hour"));
    // Max publishes no 5-hour cap and pools $150 a week and $900 a month, so the
    // same spend is inside every window — no verdict against a cap it never
    // publishes.
    assert_eq!(over_window(&report, &plan("max")), None);
}

#[test]
fn a_window_exactly_on_its_cap_is_over_it() {
    let now = NOW_MS;
    let since = crate::oduse::window::calendar_month_start(now);
    let mut report = build(&[], &catalog(), od::DEFAULT_PLAN, now, Some(since));
    // The frame flags `share >= 100.0`, so the notification must agree at the
    // exact figure rather than one cent above it.
    report.five_hour.credits = 18.0;
    assert_eq!(over_window(&report, &plan("go")), Some("5-hour"));
    report.five_hour.credits = 17.99;
    assert_eq!(over_window(&report, &plan("go")), None);
    report.month.credits = 220.0;
    assert_eq!(over_window(&report, &plan("go")), Some("monthly"));
}

#[test]
fn models_sort_by_month_credits() {
    let now = NOW_MS;
    let since = crate::oduse::window::calendar_month_start(now);
    let rows = vec![
        row(now - 60_000, "glm-5.3-flash", 1_000_000, 0),
        row(now - 60_000, "gpt-6-luna", 1_000_000, 0),
    ];
    let report = build(&rows, &catalog(), od::DEFAULT_PLAN, now, Some(since));
    assert_eq!(report.models[0].id, "gpt-6-luna", "{:?}", report.models);
}

#[test]
fn an_unpriced_model_counts_turns_and_credits_nothing() {
    let now = NOW_MS;
    let since = crate::oduse::window::calendar_month_start(now);
    let rows = vec![row(now - 60_000, "some-new-model", 5_000, 100)];
    let report = build(&rows, &catalog(), od::DEFAULT_PLAN, now, Some(since));
    let model = &report.models[0];
    assert!(!model.priced, "no rate for this id");
    assert_eq!(model.month.requests, 1);
    assert_eq!(model.month.credits, 0.0);
    assert_eq!(model.month.tokens(), 5_100);
    // Silence is the defect: the turn is counted, so the window must say how
    // many of its requests carry no figure.
    assert_eq!(report.month.unpriced, 1, "{:?}", report.month);
    assert_eq!(report.five_hour.unpriced, 1, "{:?}", report.five_hour);
    assert_eq!(report.weekly.unpriced, 1, "{:?}", report.weekly);
}

#[test]
fn the_window_lengths_are_the_published_ones() {
    assert_eq!(FIVE_HOUR_SECS, 18_000);
    assert_eq!(WEEKLY_SECS, 604_800);
}
