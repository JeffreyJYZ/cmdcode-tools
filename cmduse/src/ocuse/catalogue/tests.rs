// Catalogue tests: the payload -> catalogue conversion, and how provenance
// renders. No network — every payload is the pinned [`SAMPLE`] (five models
// trimmed verbatim out of the live `/zen/go/v1/models` body on 2026-11-20).
//
// [`tests_cache`](super::tests_cache) covers the cache and fallback paths; it
// reuses this module's helpers, hence `pub(super)`.
use super::*;
use crate::ocuse::window::now_ms;

/// Five real rows: a peak-sheet model, two context-tiered ones (one of them with
/// a cache-write TTL map), a scheduled-reprice multiplier, and a free model with
/// no plan limit at all.
pub(super) const SAMPLE: &str = include_str!("sample.json");

const NAMES: [&str; 5] = [
    "beam-free",
    "deepseek-v4.1-flash",
    "gemini-4-argon",
    "glm-5.3-flash",
    "gpt-6-luna",
];

/// Options pointed at a temp dir, so no test touches the real `~/.cache/cmduse`.
pub(super) fn opts(dir: &std::path::Path) -> Options {
    Options {
        cache_dir: Some(dir.to_path_buf()),
        ..Options::default()
    }
}

pub(super) fn converted() -> Catalog {
    convert::convert(SAMPLE, &zen::builtin(), now_ms()).expect("the pinned payload converts")
}

fn model<'a>(catalog: &'a Catalog, id: &str) -> &'a zen::Model {
    catalog
        .go
        .models
        .iter()
        .find(|model| model.id == id)
        .unwrap_or_else(|| panic!("{id} is in the fixture"))
}

#[test]
fn the_live_payload_converts_into_the_seed_shape() {
    let catalog = converted();
    let ids: Vec<&str> = catalog
        .go
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect();
    assert_eq!(ids, NAMES, "every priced model, sorted by id");
    // The plans are discovered from `go.monthly_usage`, not a hardcoded list.
    assert_eq!(catalog.plan_ids(), vec!["go", "go-plus", "go-teams"]);
    // The defect this module exists for: the limit is the endpoint's, not $80.
    assert_eq!(catalog.go_limit("go", "deepseek-v4.1-flash"), Some(100.0));
    assert_eq!(
        catalog.go_limit("go-plus", "deepseek-v4.1-flash"),
        Some(200.0)
    );
    assert_eq!(
        catalog.go_limit("go-teams", "deepseek-v4.1-flash"),
        Some(105.0)
    );
    assert_eq!(catalog.go_limit("go", "glm-5.3-flash"), Some(60.0));
    // A free model publishes `monthly_usage: null`, so it has no allowance.
    assert_eq!(catalog.go_limit("go", "beam-free"), None);
    // Prices are the docs', which the endpoint does not carry: from the seed.
    assert_eq!(catalog.plan("go").map(|p| p.price_usd), Some(10.0));
    assert_eq!(catalog.plan("go-plus").map(|p| p.price_usd), Some(40.0));
    assert_eq!(catalog.plan("go-teams").map(|p| p.price_usd), Some(20.0));
    // The Zen table is a second endpoint, so it stays from the seed — and its
    // window split is the docs' 20/50/100.
    assert_eq!(catalog.zen.models.len(), zen::builtin().zen.models.len());
    assert_eq!(catalog.go.window_share.five_hour, 0.2);
    assert!(cmduse_core::dates::parse_iso_utc(&catalog.extracted_at).is_some());
    assert!(has_limits(&catalog));
}

#[test]
fn rates_keep_the_peak_sheet_and_skip_other_multipliers() {
    let catalog = converted();
    let flash = model(&catalog, "deepseek-v4.1-flash");
    assert_eq!(
        flash.name, "DeepSeek V4.1 Flash 1017",
        "the endpoint's name"
    );
    // One time-of-day multiplier -> both sheets, doubled.
    assert_eq!(flash.variants.len(), 2);
    assert_eq!(flash.variants[0].peak.as_deref(), Some("off-peak"));
    assert_eq!(flash.variants[1].peak.as_deref(), Some("peak"));
    assert_eq!(flash.variants[1].input, 0.3);
    assert_eq!(flash.variants[1].output, 1.2);
    assert_eq!(flash.variants[1].cache_read, 0.006);
    // A `date` multiplier is a scheduled reprice, not a peak sheet.
    let argon = model(&catalog, "gemini-4-argon");
    assert_eq!(argon.variants.len(), 1);
    assert_eq!(argon.variants[0].input, 2.0);
    // Context tiers are kept as separate rows: the base tier and the one above
    // 272k tokens, each pricing its own cache-write TTL map at its cheapest
    // (shortest-TTL) entry.
    let luna = model(&catalog, "gpt-6-luna");
    assert_eq!(luna.variants.len(), 2);
    assert_eq!(luna.variants[0].tier_max_tokens, Some(272_000));
    assert_eq!(luna.variants[0].cache_write, 0.125);
    assert_eq!(luna.variants[1].tier_min_tokens, Some(272_000));
    assert_eq!(luna.variants[1].input, 0.2);
    assert_eq!(luna.variants[1].cache_write, 0.25);
    // A free model keeps a zero rate row rather than vanishing from the table.
    let free = model(&catalog, "beam-free");
    assert_eq!(free.variants[0].input, 0.0);
}

#[test]
fn an_unknown_plan_still_gets_a_label_and_no_invented_price() {
    // A plan the seed has never seen: the endpoint names it, the label is
    // derived from the slug, and the price is absent rather than $0.
    let body = r#"{"object":"list","data":[{"id":"m","name":"M","cost":{"text":{"input":{"price":1},"output":{"price":2}}},"go":{"monthly_usage":{"go-plus":7,"go-max":9}}}]}"#;
    let catalog = convert::convert(body, &zen::builtin(), now_ms()).expect("converts");
    assert_eq!(catalog.plan_ids(), vec!["go-max", "go-plus"]);
    let max = catalog.plan("go-max").expect("go-max");
    assert_eq!(max.label, "Go Max");
    assert_eq!(max.price_usd, 0.0);
    assert_eq!(catalog.go_limit("go-max", "m"), Some(9.0));
    // A plan already in the seed keeps its documented price and label.
    assert_eq!(catalog.plan("go-plus").map(|p| p.price_usd), Some(40.0));
}

#[test]
fn provenance_renders_every_source_distinctly() {
    let at = cmduse_core::dates::parse_iso_utc("2026-11-20T09:44:00Z").map(|ms| ms as i64);
    let live = Provenance {
        source: Source::Live,
        at,
        age_secs: 0,
        error: None,
    };
    assert_eq!(live.describe(), "live · fetched 2026-11-20T09:44Z");
    let cached = Provenance {
        source: Source::Cache,
        at,
        age_secs: 3 * 3600,
        error: None,
    };
    assert_eq!(cached.label(), "cache, 3h old");
    assert!(cached.describe().contains("written 2026-11-20T09:44Z"));
    assert_eq!(cached.json()["source"], "cache");
    // A fallback is never dressed up as fresh data.
    let seeded = Provenance {
        source: Source::Builtin,
        at,
        age_secs: 0,
        error: Some("catalogue: HTTP 503".into()),
    };
    assert!(seeded.describe().starts_with("builtin · generated"));
    assert!(seeded.describe().ends_with("catalogue: HTTP 503"));
    assert_eq!(seeded.json()["error"], "catalogue: HTTP 503");
}
