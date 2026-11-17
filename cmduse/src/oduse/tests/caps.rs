// The per-model cap sets on screen: which of a plan's published sets a row used,
// and the other figure it would have been. Split from `render` because it is one
// subject — the caps — and the frame file had reached the repo's line cap.
use super::fixture::{plan, row, NOW_MS};
use crate::oduse::render::{self, DEFAULT_BAR_WIDTH};

/// A window holding both DeepSeek variants is charged against the stricter set
/// and names the looser one, so no reader can think every turn drew the $220
/// Eco pool when the Flash turns only get $120.
#[test]
fn a_mixed_window_names_the_cap_set_it_used() {
    let rows = vec![
        row(NOW_MS - 60_000, "deepseek-v4.1-flash", 1_000_000, 0),
        row(NOW_MS - 60_000, "deepseek-v4.1-flash-eco", 1_000_000, 0),
    ];
    let report = super::fixture::report(&rows);
    let text = render::render_text(&report, &plan("go"), "/tmp/a.db", 10, false, 20);
    let monthly = text
        .lines()
        .find(|l| l.contains("Monthly"))
        .expect("a monthly row");
    assert!(
        monthly.contains("of $120.00"),
        "the stricter set: {monthly}"
    );
    assert!(
        monthly.contains("Flash caps; Eco would be $220.00"),
        "the other set must be named: {monthly}"
    );
    // The 5-hour row is capped at the Flash $10, not the Eco $18.
    let five = text
        .lines()
        .find(|l| l.contains("5-hour"))
        .expect("a 5-hour row");
    assert!(five.contains("of $10.00"), "{five}");
    // …and the week at $30, not $55.
    let week = text
        .lines()
        .find(|l| l.contains("Weekly"))
        .expect("a weekly row");
    assert!(week.contains("of $30.00"), "{week}");
}

/// A single-set plan never grows a note: there is no second figure to name.
#[test]
fn a_single_set_plan_prints_no_cap_note() {
    let report =
        super::fixture::report(&[row(NOW_MS - 60_000, "deepseek-v4.1-flash", 1_000_000, 0)]);
    let text = render::render_text(&report, &plan("pro"), "/tmp/a.db", 10, false, 20);
    assert!(!text.contains("would be"), "{text}");
    assert!(text.contains("of $480.00"), "{text}");
}

/// The heading names every set the plan publishes, so a reader knows the rows
/// below may differ before reading them.
#[test]
fn the_heading_lists_the_other_sets() {
    let report = super::fixture::report(&[row(
        NOW_MS - 60_000,
        "deepseek-v4.1-flash-eco",
        1_000_000,
        0,
    )]);
    let text = render::render_text(&report, &plan("go"), "/tmp/a.db", 10, false, 20);
    let heading = text
        .lines()
        .find(|l| l.contains("DESIGN"))
        .expect("the plan heading");
    assert!(heading.contains("per model:"), "{heading}");
    assert!(heading.contains("Flash $120.00/mo"), "{heading}");
    assert!(heading.contains("Eco $220.00/mo"), "{heading}");
}

/// The tiny-terminal compact line divides by the same chosen set, not the plan's
/// headline: a report holding the original Flash is capped at $120 on Go.
#[test]
fn the_compact_line_uses_the_chosen_set() {
    let rows = vec![
        row(NOW_MS - 60_000, "deepseek-v4.1-flash", 1_000_000, 0),
        row(NOW_MS - 60_000, "deepseek-v4.1-flash-eco", 1_000_000, 0),
    ];
    let report = super::fixture::report(&rows);
    let line = render::compact_line(&report, &plan("go"), &[], false);
    assert!(line.contains("$120.00"), "{line}");
    assert!(line.contains("(Flash)"), "{line}");
    assert!(!line.contains("$220.00"), "{line}");
}

/// The colour flag cannot change the figures or the note.
#[test]
fn the_cap_note_survives_both_colour_modes() {
    let rows = vec![
        row(NOW_MS - 60_000, "deepseek-v4.1-flash", 1_000_000, 0),
        row(NOW_MS - 60_000, "deepseek-v4.1-flash-eco", 1_000_000, 0),
    ];
    let report = super::fixture::report(&rows);
    for colour in [false, true] {
        let text = render::render_text(
            &report,
            &plan("go"),
            "/tmp/a.db",
            10,
            colour,
            DEFAULT_BAR_WIDTH,
        );
        assert!(text.contains("Eco would be $220.00"), "{text}");
    }
}
