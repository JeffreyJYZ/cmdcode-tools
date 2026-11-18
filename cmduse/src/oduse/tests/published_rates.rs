// Every figure below is transcribed from
// `docs/plan/opendesign/reference/od-model-prices.json` — the verbatim body of
// `GET https://amr-api.open-design.ai/api/v1/public/model-prices` fetched
// 2026-11-17. Pinning all 46 rows is what stops a rate drifting back to a
// secondhand zen seed or an estimate.
use crate::oduse::db::Row;
use crate::oduse::od;
use crate::oduse::price::row_cost;

/// (wire id, input $/1M, output $/1M, cacheRead $/1M).
const RATES: &[(&str, f64, f64, f64)] = &[
    ("claude-fable-5", 10.0, 50.0, 1.0),
    ("claude-fable-5.1", 10.0, 50.0, 0.25),
    ("claude-fable-5.2", 8.0, 40.0, 0.2),
    ("claude-haiku-5.5", 0.1, 0.5, 0.01),
    ("claude-opus-4.8", 5.0, 25.0, 0.5),
    ("claude-opus-5", 5.0, 25.0, 0.5),
    ("claude-opus-5.5", 4.0, 20.0, 0.2),
    ("claude-sonnet-5", 2.0, 10.0, 0.2),
    ("claude-sonnet-5.5", 2.0, 10.0, 0.2),
    ("deepseek-v4.1-flash", 0.3, 1.2, 0.006),
    ("deepseek-v4.1-flash-eco", 0.3, 1.2, 0.006),
    ("deepseek-v4-flash", 0.44, 1.32, 0.014),
    ("deepseek-v4-flash-vision-exp", 0.44, 1.32, 0.014),
    ("deepseek-v4-pro", 1.32, 3.96, 0.044),
    ("gemini-3.7-flash", 1.5, 7.5, 0.15),
    ("gemini-3.8-flash", 1.5, 7.5, 0.15),
    ("gemini-4-argon", 4.0, 20.0, 0.2),
    ("gemini-4-carbon", 4.0, 20.0, 0.2),
    ("glm-5.2", 1.4, 4.4, 0.26),
    ("glm-5.3-flash", 0.075, 0.25, 0.015),
    ("glm-5.3-flashx", 0.37, 1.25, 0.075),
    ("gpt-5.6-luna", 0.2, 1.2, 0.02),
    ("gpt-5.6-sol", 4.0, 20.0, 0.4),
    ("gpt-5.6-terra", 2.0, 12.0, 0.2),
    ("gpt-6.1-sol", 2.0, 10.0, 0.1),
    ("gpt-6.1-terra", 1.0, 5.0, 0.05),
    ("gpt-6-astra", 10.0, 50.0, 1.0),
    ("gpt-6-luna", 0.1, 0.5, 0.01),
    ("gpt-6-sol", 2.0, 10.0, 0.2),
    ("grok-4.5", 2.0, 6.0, 0.5),
    ("grok-4.6", 2.0, 6.0, 0.5),
    ("grok-4.7", 2.0, 6.0, 0.5),
    ("hy4", 0.834, 2.501, 0.042),
    ("hy4-flash", 0.07, 0.281, 0.003),
    ("hy4-preview", 0.834, 2.501, 0.042),
    ("kimi-k2.7-code", 0.95, 4.0, 0.19),
    ("kimi-k3", 3.0, 15.0, 0.3),
    ("kimi-k3.1-pro", 2.0, 10.0, 0.2),
    ("mimo-v2.6-flash", 0.14, 0.28, 0.0028),
    ("mimo-v2.6-pro", 0.435, 0.87, 0.0036),
    ("minimax-m3.1-flash", 0.15, 0.6, 0.015),
    ("muse-ember-1.0", 0.1, 0.5, 0.004),
    ("muse-spark-1.3", 1.25, 4.25, 0.15),
    ("muse-wonder", 4.0, 20.0, 0.2),
    ("qwen3.7-max", 2.5, 7.5, 0.5),
    ("qwen4-max", 1.5, 4.5, 0.075),
];

#[test]
fn every_published_row_matches_the_reference_payload() {
    let c = od::catalog();
    assert_eq!(RATES.len(), 46);
    assert_eq!(c.models.len(), RATES.len(), "no row is missing or extra");
    for (id, input, output, cache) in RATES {
        let m = c
            .model(id)
            .unwrap_or_else(|| panic!("{id} is in the price list"));
        assert_eq!(m.input, *input, "{id} input");
        assert_eq!(m.output, *output, "{id} output");
        assert_eq!(m.cache_read, Some(*cache), "{id} cache read");
        assert_eq!(
            m.rate_source.as_deref(),
            Some("published"),
            "{id} provenance"
        );
    }
}

/// The 32 payload-only ids are priced, not silently unpriced: a real lane can
/// hit `hy4-flash` or `kimi-k3`, so the old fall-through to `cost: 0` is gone.
#[test]
fn a_payload_only_model_is_priced() {
    let c = od::catalog();
    let priced = row_cost(
        &Row {
            model: "hy4-flash".into(),
            input: 1_000_000,
            ..Row::default()
        },
        &c,
    );
    assert!(priced.priced);
    assert!((priced.cost - 0.07).abs() < 1e-9, "{}", priced.cost);
    assert!(!priced.cache_estimated);
}

/// Claude Haiku 5.5's tier is `@100000`: 0.5/2.5/0.05 replace 0.1/0.5/0.01 for
/// the whole turn. 101k in + 1k out + 1k cache = $0.05355 list, x2 = 0.1071.
#[test]
fn a_long_context_turn_reprices_every_class() {
    let c = od::catalog();
    let priced = row_cost(
        &Row {
            model: "claude-haiku-5.5".into(),
            input: 101_000,
            output: 1_000,
            cache_read: 1_000,
            ..Row::default()
        },
        &c,
    );
    // 101000*0.5 + 1000*2.5 + 1000*0.05 = 53050 -> $0.05305, x2 = 0.1061.
    assert!((priced.cost - 0.05305).abs() < 1e-9, "{}", priced.cost);
    assert!((priced.credits - 0.1061).abs() < 1e-9, "{}", priced.credits);
}

/// The comparison is strict: at exactly 100k the flat rate holds, and the store's
/// `input` counter alone decides it (cache reads are disjoint).
#[test]
fn a_turn_at_the_threshold_keeps_the_flat_rate() {
    let c = od::catalog();
    let priced = row_cost(
        &Row {
            model: "claude-haiku-5.5".into(),
            input: 100_000,
            output: 1_000,
            cache_read: 1_000,
            ..Row::default()
        },
        &c,
    );
    // 100k*0.1 + 1k*0.5 + 1k*0.01 = 10.51k tokens' worth = $0.01051, x2.
    assert!((priced.cost - 0.01051).abs() < 1e-9, "{}", priced.cost);
    assert!(
        (priced.credits - 0.02102).abs() < 1e-9,
        "{}",
        priced.credits
    );
}

/// GPT-6 Luna's `@272000` tier is far out: 273k in at 0.2 is $0.0546 list, x4 =
/// 0.2184 credits, double the flat-rate figure.
#[test]
fn a_high_threshold_tier_applies_above_its_own_cut() {
    let c = od::catalog();
    let priced = row_cost(
        &Row {
            model: "gpt-6-luna".into(),
            input: 273_000,
            ..Row::default()
        },
        &c,
    );
    assert!((priced.cost - 0.0546).abs() < 1e-9, "{}", priced.cost);
    assert!((priced.credits - 0.2184).abs() < 1e-9, "{}", priced.credits);
}
