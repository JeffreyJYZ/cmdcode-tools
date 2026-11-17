// The monthly row's elapsed figure: it is a share of the period the row's own
// number covers, and only when that period is one the plan actually anchors.
//
// The old reading divided the calendar month, which is not the plan's cycle — the
// 7-day window resets at the subscription anniversary — so the figure answered a
// question nobody asked. These tests pin the three honest cases.
use super::fixture::{plan, row, NOW_MS};
use crate::oduse::render::{self, DEFAULT_BAR_WIDTH};

fn monthly_line(report: &crate::oduse::window::Report) -> String {
    render::render_text(
        report,
        &plan("go"),
        "/tmp/a.db",
        10,
        false,
        DEFAULT_BAR_WIDTH,
    )
    .lines()
    .find(|l| l.contains("Monthly"))
    .expect("a monthly row")
    .to_string()
}

/// A pinned `--period-start` is a boundary the caller named, so the share is the
/// arithmetic one: `(now - start) / (end - start)`.
#[test]
fn a_pinned_period_yields_the_arithmetic_share() {
    let day = 86_400_000;
    let mut report = super::fixture::report(&[row(NOW_MS - 60_000, "glm-5.3-flash", 1_000, 10)]);
    // A 10-day period with 2.5 days elapsed is a quarter of it.
    report.since_ms = NOW_MS - 2 * day - 12 * 3_600_000;
    report.period_end_ms = Some(report.since_ms + 10 * day);
    report.period_anchored = true;
    let line = monthly_line(&report);
    assert!(line.contains("window 25.0% elapsed"), "{line}");
    assert!(
        line.contains("by now"),
        "the even-burn figure belongs here: {line}"
    );
    assert!(line.contains("ends "), "{line}");
}

/// `--window all` has no boundary, so there is nothing to be a share of. It must
/// say so rather than print a percentage of an unrelated span.
#[test]
fn a_period_with_no_end_has_no_percentage() {
    let mut report = super::fixture::report(&[row(NOW_MS - 60_000, "glm-5.3-flash", 1_000, 10)]);
    report.since_ms = 0;
    report.period_end_ms = None;
    report.period_anchored = false;
    let line = monthly_line(&report);
    assert!(!line.contains("% elapsed"), "{line}");
    assert!(!line.contains("by now"), "{line}");
    assert!(
        line.contains("no period anchor"),
        "absence is stated, not silent: {line}"
    );
}

/// The default calendar month is *not* an anchor: the plan's cycle is the
/// subscription anniversary, so the frame refuses the share and says why.
#[test]
fn a_calendar_month_is_not_an_anchor() {
    let mut report = super::fixture::report(&[row(NOW_MS - 60_000, "glm-5.3-flash", 1_000, 10)]);
    report.period_anchored = false;
    assert!(report.period_end_ms.is_some(), "the month has an end");
    let line = monthly_line(&report);
    assert!(!line.contains("% elapsed"), "{line}");
    assert!(line.contains("no period anchor"), "{line}");
    assert!(
        line.contains("ends "),
        "the end date is still a fact: {line}"
    );
}

/// An inferred anniversary is an anchor, so its share is taken from that
/// boundary — the day-of-month the store's oldest turn stands in for.
#[test]
fn the_anniversary_inference_yields_a_share_from_that_boundary() {
    use crate::oduse::window::{build, Span};
    let day = 86_400_000;
    // A turn 40 days back makes the 16th-of-month anniversary the boundary.
    let rows = vec![row(NOW_MS - 40 * day, "glm-5.3-flash", 1_000, 10)];
    let mut report = build(&rows, &super::fixture::catalog(), "go", NOW_MS, None);
    assert!(report.month_inferred, "the anniversary was inferred");
    report.period_end_ms = crate::oduse::period::end(report.since_ms, "month", true);
    report.period_anchored = true;
    let line = monthly_line(&report);
    assert!(
        line.contains("% elapsed"),
        "the anchor makes a share real: {line}"
    );
    // The share is of the anniversary month, never of the calendar one.
    let elapsed = (NOW_MS - report.since_ms) as f64
        / (report.period_end_ms.unwrap() - report.since_ms) as f64;
    let printed: f64 = line
        .split("window ")
        .nth(1)
        .and_then(|s| s.split('%').next())
        .and_then(|s| s.parse().ok())
        .expect("a percentage");
    assert!(
        (printed - elapsed * 100.0).abs() < 0.15,
        "printed {printed} against {:.1}",
        elapsed * 100.0
    );
    // And the cap pick for that window is sane for an Eco-free store.
    let pick = crate::oduse::window::window_caps(&report.models, &plan("go"), Span::Month);
    assert_eq!(
        pick.chosen.monthly_usd, 220.0,
        "GLM draws the plan's own set"
    );
}
