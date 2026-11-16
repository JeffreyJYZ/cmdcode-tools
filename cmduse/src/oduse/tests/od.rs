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
fn a_published_rate_matches_the_id_it_is_labelled_with() {
    // `rateSource: "repo"` claims a figure from the repo's own catalogue. Where
    // that catalogue is `core/zen.json`, the model must be there with exactly
    // these rates — a row copied from a sibling id is the defect this catches.
    // The lookup uses `catalogId` (default: the wire id), because the shelf
    // spells some ids differently from the gateway that serves them.
    let c = od::catalog();
    let zen = zen_rates();
    let mut via_shelf = 0;
    for model in c.models.iter().filter(|m| m.rate_source == "repo") {
        let id = model.catalog_id();
        let published: Vec<&(String, f64, f64)> =
            zen.iter().filter(|(zen_id, ..)| zen_id == id).collect();
        if published.is_empty() {
            // Not sold on Go/Zen: `opencode-plugin/src/catalog.ts` is its source,
            // which this crate cannot read — the pin below covers that one row.
            continue;
        }
        via_shelf += 1;
        assert!(
            published
                .iter()
                .any(|(_, input, output)| *input == model.input && *output == model.output),
            "{} claims {}/${} but zen.json's {id} has {published:?}",
            model.id,
            model.input,
            model.output
        );
    }
    // The lookup must actually have matched rows, or the loop proves nothing.
    assert!(
        via_shelf > 5,
        "only {via_shelf} rows resolved against zen.json"
    );
    // Claude Haiku 5.5 is served as `claude-haiku-5.5` and sold as
    // `claude-haiku-5-5`: the row is keyed by the wire id and names the shelf
    // spelling separately, so a recorded turn prices.
    let haiku = c
        .model("claude-haiku-5.5")
        .expect("row keyed by the wire id");
    assert_eq!(haiku.catalog_id(), "claude-haiku-5-5");
    assert_eq!((haiku.input, haiku.output), (0.1, 0.5));
    // MiniMax M3.1 Flash is not on the Go/Zen shelf, so its rate is the plugin
    // catalogue's own (0.15 / 0.6) — never the sibling `minimax-m3` row's.
    let minimax = c.model("minimax-m3.1-flash").expect("row exists");
    assert_eq!((minimax.input, minimax.output), (0.15, 0.6));
}

/// `(id, input, output)` for every variant the Go/Zen catalogue lists.
fn zen_rates() -> Vec<(String, f64, f64)> {
    let root: serde_json::Value =
        serde_json::from_str(cmduse_core::ZEN_JSON).expect("zen.json parses");
    let mut out = Vec::new();
    for plan in root.as_object().into_iter().flatten().map(|(_, v)| v) {
        let Some(models) = plan.get("models").and_then(|m| m.as_array()) else {
            continue;
        };
        for model in models {
            let id = model["id"].as_str().unwrap_or_default();
            for variant in model["variants"].as_array().into_iter().flatten() {
                if let (Some(input), Some(output)) =
                    (variant["input"].as_f64(), variant["output"].as_f64())
                {
                    out.push((id.to_string(), input, output));
                }
            }
        }
    }
    out
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
