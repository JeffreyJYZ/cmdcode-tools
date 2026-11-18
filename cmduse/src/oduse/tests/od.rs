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
    // 1M in + 1M out on DeepSeek V4.1 Flash: $0.3 + $1.2 list from the published
    // price list, x0.5 from the plan page -> $1.5 list, 0.75 credits.
    assert_eq!(
        c.price("deepseek-v4.1-flash", 1_000_000, 1_000_000),
        Some(1.5)
    );
    assert_eq!(
        c.credits("deepseek-v4.1-flash", 1_000_000, 1_000_000),
        Some(0.75)
    );
    // GPT-6 Luna is the premium end: its flat rates are 0.1/0.5, x4.
    assert_eq!(c.multiplier("gpt-6-luna"), 4.0);
    assert_eq!(c.credits("gpt-6-luna", 1_000_000, 1_000_000), Some(2.4));
    // An unknown model is priced as nothing and multiplied by 1 — never free.
    assert_eq!(c.price("nope", 1_000_000, 0), None);
    assert_eq!(c.credits("nope", 1_000_000, 0), None);
    assert_eq!(c.multiplier("nope"), 1.0);
}

#[test]
fn every_row_is_sourced_from_the_published_price_list() {
    let c = od::catalog();
    // No secondhand "repo" seed and no "estimate" survives: Open Design's own
    // list covers all 46 rows, including the 32 that used to be unpriced.
    assert!(c
        .models
        .iter()
        .all(|m| m.rate_source.as_deref() == Some("published")));
    assert!(c.models.iter().all(|m| m.cache_read.is_some()));
    assert_eq!(c.models.len(), 46);
    // `price()` stays flat: it has no token count, so it cannot choose a tier.
    assert_eq!(c.price("claude-haiku-5.5", 1_000_000, 0), Some(0.1));
    // Haiku's `catalogId` still names the old Go/Zen spelling for provenance;
    // pricing and the price list both key on the wire id.
    let haiku = c
        .model("claude-haiku-5.5")
        .expect("row keyed by the wire id");
    assert_eq!(haiku.catalog_id(), "claude-haiku-5-5");
    assert_eq!((haiku.input, haiku.output), (0.1, 0.5));
    // MiniMax M3.1 Flash's flat rates did not change; its cache rate did.
    let minimax = c.model("minimax-m3.1-flash").expect("row exists");
    assert_eq!((minimax.input, minimax.output), (0.15, 0.6));
    assert_eq!(minimax.cache_read, Some(0.015));
}

#[test]
fn a_row_with_no_rate_source_carries_no_provenance_claim() {
    // The field is optional on purpose: a row with no label must still parse,
    // and must not be silently promoted to `published` by a default string.
    let m: od::Model =
        serde_json::from_str(r#"{"id":"x","label":"X","multiplier":1,"input":1,"output":2}"#)
            .expect("an unlabelled row parses");
    assert_eq!(m.rate_source, None);
    let estimated: od::Model = serde_json::from_str(
        r#"{"id":"y","label":"Y","multiplier":1,"input":1,"output":2,"rateSource":"estimate"}"#,
    )
    .expect("an estimated row parses");
    assert_eq!(estimated.rate_source.as_deref(), Some("estimate"));
}

#[test]
fn every_rate_says_whether_it_is_published() {
    let c = od::catalog();
    assert!(c.models.iter().all(|m| !m.label.is_empty()));
    assert!(c
        .models
        .iter()
        .any(|m| m.rate_source.as_deref() == Some("published") && m.id == "glm-5.3-flash"));
    // The two old estimates are published too, and their figures changed.
    let eco = c.model("deepseek-v4.1-flash-eco").expect("eco row");
    assert_eq!((eco.input, eco.output), (0.3, 1.2));
    let flashx = c.model("glm-5.3-flashx").expect("flashx row");
    assert_eq!((flashx.input, flashx.output), (0.37, 1.25));
    // The docs' one clause about the unit has to survive in the data.
    assert!(c.credit_unit.contains("credit"));
    assert!(!c.notes.is_empty());
}
