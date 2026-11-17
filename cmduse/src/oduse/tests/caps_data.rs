// Per-model cap sets: Go publishes two, Pro/Max one. Split from `od` because it
// is one subject and that test file reached the repo's line cap.
use crate::oduse::od;

/// Go publishes two cap sets: the Eco one ($220/$55/$18) every plan row shows,
/// and the original Flash one ($120/$30/$10) which is stricter. A model resolves
/// to its own, so the two DeepSeek variants cannot share a pool.
#[test]
fn go_caps_are_per_model_class() {
    let c = od::catalog();
    let go = c.plan("go").expect("go");
    let eco = go.cap_set_for("deepseek-v4.1-flash-eco");
    assert_eq!(
        (eco.monthly_usd, eco.weekly_usd, eco.five_hour_usd),
        (220.0, Some(55.0), Some(18.0)),
        "the plan's own set"
    );
    assert_eq!(eco.id, "eco");
    assert_eq!(eco.label, "Eco");
    let flash = go.cap_set_for("deepseek-v4.1-flash");
    assert_eq!(
        (flash.monthly_usd, flash.weekly_usd, flash.five_hour_usd),
        (120.0, Some(30.0), Some(10.0)),
        "the original Flash allowance, published in /help/billing"
    );
    assert_eq!(flash.id, "flash");
    assert_eq!(flash.label, "Flash");
    // A model with no override falls back to the plan's own set.
    let glm = go.cap_set_for("glm-5.3-flash");
    assert_eq!(glm.monthly_usd, 220.0);
    assert_eq!(glm.id, "eco");
}

/// A window holding both variants is capped by the stricter one, and the pick
/// carries the looser figure so the frame can say what it would have been.
#[test]
fn a_mixed_window_takes_the_stricter_set_and_keeps_the_other() {
    use crate::oduse::tests::fixture::{report, row, NOW_MS};
    use crate::oduse::window::{window_caps, Span};
    let rows = vec![
        row(NOW_MS - 60_000, "deepseek-v4.1-flash", 1_000_000, 0),
        row(NOW_MS - 60_000, "deepseek-v4.1-flash-eco", 1_000_000, 0),
    ];
    let report = report(&rows);
    let pick = window_caps(
        &report.models,
        &crate::oduse::tests::fixture::plan("go"),
        Span::Month,
    );
    assert_eq!(pick.chosen.id, "flash", "stricter wins");
    assert_eq!(pick.chosen.label, "Flash");
    assert_eq!(pick.chosen.monthly_usd, 120.0);
    assert_eq!(
        pick.looser.as_ref().map(|l| l.monthly_usd),
        Some(220.0),
        "the Eco figure is kept so the frame can name it"
    );
    // Flash alone still picks Flash; Eco alone picks Eco and compares nothing.
    let eco_only = report_for(&["deepseek-v4.1-flash-eco"]);
    let pick = window_caps(
        &eco_only.models,
        &crate::oduse::tests::fixture::plan("go"),
        Span::Month,
    );
    assert_eq!(pick.chosen.id, "eco");
    assert!(pick.looser.is_none(), "a single set has nothing to compare");
}

/// A model that did not spend in a window cannot make that window stricter: the
/// Flash row sitting idle must not shrink the Eco-only month's cap.
#[test]
fn only_the_models_that_spent_pick_the_cap() {
    use crate::oduse::window::{window_caps, Span};
    let now = crate::oduse::tests::fixture::NOW_MS;
    // The Flash turn is 10 days old: inside the calendar month (the fixture's
    // NOW_MS is the 15th), outside the 7-day cut.
    let report = report_for_at(&[
        ("deepseek-v4.1-flash-eco", now - 60_000),
        ("deepseek-v4.1-flash", now - 10 * 86_400_000),
    ]);
    let month = window_caps(
        &report.models,
        &crate::oduse::tests::fixture::plan("go"),
        Span::Month,
    );
    assert_eq!(
        month.chosen.id, "flash",
        "the old Flash turn is in the month"
    );
    let week = window_caps(
        &report.models,
        &crate::oduse::tests::fixture::plan("go"),
        Span::Weekly,
    );
    assert_eq!(week.chosen.id, "eco", "only the Eco turn is in the week");
}

/// Pro/Max publish one set and list no Eco model, so their caps never vary.
#[test]
fn pro_has_one_set_and_no_eco_row() {
    let c = od::catalog();
    let pro = c.plan("pro").expect("pro");
    assert!(pro.cap_overrides.is_empty(), "no per-model override");
    assert!(pro.default_cap_label.is_none(), "no second label to name");
    for model in [
        "deepseek-v4.1-flash",
        "deepseek-v4.1-flash-eco",
        "glm-5.3-flash",
    ] {
        let set = pro.cap_set_for(model);
        assert_eq!(set.monthly_usd, 480.0, "{model}");
        assert_eq!(set.weekly_usd, Some(90.0), "{model}");
        assert_eq!(set.five_hour_usd, None, "{model} has no 5-hour cap");
    }
    // No plan other than Go publishes an override.
    for plan in ["plus", "max"] {
        assert!(
            c.plan(plan).is_some_and(|p| p.cap_overrides.is_empty()),
            "{plan} publishes one set"
        );
    }
}

/// Reports for the cap-pick tests: one turn per named model, all at `now`.
fn report_for(models: &[&str]) -> crate::oduse::window::Report {
    let now = crate::oduse::tests::fixture::NOW_MS;
    let rows: Vec<_> = models
        .iter()
        .map(|m| crate::oduse::tests::fixture::row(now - 60_000, m, 1_000_000, 0))
        .collect();
    crate::oduse::tests::fixture::report(&rows)
}

/// One turn per `(model, at)` pair, so a test can age a model out of a window.
fn report_for_at(turns: &[(&str, i64)]) -> crate::oduse::window::Report {
    let rows: Vec<_> = turns
        .iter()
        .map(|(m, at)| crate::oduse::tests::fixture::row(*at, m, 1_000_000, 0))
        .collect();
    crate::oduse::tests::fixture::report(&rows)
}
