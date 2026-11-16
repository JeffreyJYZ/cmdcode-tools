// The catalogue: four plans, their published caps, and the credit arithmetic.
use crate::oduse::od;

#[test]
fn catalogue_carries_the_four_plans_and_their_caps() {
    let c = od::catalog();
    assert_eq!(c.plan_ids(), vec!["go", "plus", "pro", "max"]);
    let go = c.plan("go").expect("go");
    assert_eq!(go.price_usd, 10.0);
    assert_eq!(go.monthly_usd, 220.0);
    assert_eq!(go.weekly_usd, Some(55.0));
    assert_eq!(go.five_hour_usd, Some(18.0));
    assert_eq!(go.plan_model_credits_usd, 0.0);
    assert_eq!(go.concurrency, 10);
    // Only Go throttles on a 5-hour basis; the rest publish no such cap, so the
    // dashboard must print an absent row rather than a zero one.
    for plan in ["plus", "pro", "max"] {
        assert_eq!(
            c.plan(plan).and_then(|p| p.five_hour_usd),
            None,
            "{plan} has no published 5-hour cap"
        );
    }
    assert_eq!(c.plan("plus").map(|p| p.plan_model_credits_usd), Some(20.0));
    assert_eq!(c.plan("max").map(|p| p.monthly_usd), Some(900.0));
}

#[test]
fn credits_are_the_list_price_times_the_multiplier() {
    let c = od::catalog();
    // 1M in + 1M out on DeepSeek V4.1 Flash: $0.15 + $0.60 list, x0.5.
    assert_eq!(
        c.price("deepseek-v4.1-flash", 1_000_000, 1_000_000),
        Some(0.75)
    );
    assert_eq!(
        c.credits("deepseek-v4.1-flash", 1_000_000, 1_000_000),
        Some(0.375)
    );
    // GPT-6 Luna is the premium end: x4.
    assert_eq!(c.multiplier("gpt-6-luna"), 4.0);
    assert_eq!(c.credits("gpt-6-luna", 1_000_000, 1_000_000), Some(2.4));
    // An unknown model is priced as nothing and multiplied by 1 — never free.
    assert_eq!(c.price("nope", 1_000_000, 0), None);
    assert_eq!(c.credits("nope", 1_000_000, 0), None);
    assert_eq!(c.multiplier("nope"), 1.0);
}

#[test]
fn every_rate_says_whether_it_is_published() {
    let c = od::catalog();
    assert!(c.models.iter().all(|m| !m.label.is_empty()));
    assert!(c
        .models
        .iter()
        .any(|m| m.rate_source == "repo" && m.id == "glm-5.3-flash"));
    assert!(c
        .models
        .iter()
        .any(|m| m.rate_source == "estimate" && m.id == "deepseek-v4.1-flash-eco"));
    // The docs' one clause about the estimate has to survive in the data.
    assert!(c.credit_unit.contains("credit"));
    assert!(!c.notes.is_empty());
}
