// What one turn costs: cache reads counted, reasoning never double-counted,
// `cost: 0` never zeroing a figure, and the multiplier applied once.
use crate::oduse::db::Row;
use crate::oduse::price::{row_cost, zen_cache_read};
use crate::oduse::{od, window};

fn turn(model: &str, input: u64, output: u64, cache_read: u64) -> Row {
    Row {
        model: model.into(),
        input,
        output,
        cache_read,
        ..Row::default()
    }
}

/// DeepSeek V4.1 Flash: $0.15/$0.60 per 1M with a $0.003 cache-read rate and a
/// 0.5 multiplier. 1M input + 1M output + 1M cache read is $0.753 list, $0.3765
/// credits — the cache term is 0.4% of the list price here and 98% of a real
/// run's token mass, which is why it cannot be dropped.
#[test]
fn cache_reads_are_priced_from_the_published_rate() {
    let catalog = od::catalog();
    let priced = row_cost(
        &turn("deepseek-v4.1-flash", 1_000_000, 1_000_000, 1_000_000),
        &catalog,
    );
    assert!((priced.cost - 0.753).abs() < 1e-9, "{}", priced.cost);
    assert!((priced.credits - 0.3765).abs() < 1e-9, "{}", priced.credits);
    assert!(priced.priced);
    assert!(
        !priced.cache_estimated,
        "a published rate is not an estimate"
    );
}

/// The floor is the cheapest published sheet across **both** shelves, never
/// whichever shelf happened to be read last. `deepseek-v4.1-flash` is $0.003
/// off-peak on Go and $0.006 on Zen: taking the Zen row would double the cache
/// term, and cache is 98.6% of the token mass on the real account, so that
/// inflates every credit figure.
#[test]
fn the_cache_rate_is_the_floor_across_shelves() {
    assert_eq!(zen_cache_read("deepseek-v4.1-flash"), Some(0.003));
}

/// A model sold on one shelf only still resolves, from whichever shelf carries
/// it — the cross-shelf minimum must not require the model to be on both.
#[test]
fn a_single_shelf_model_still_resolves() {
    // `hy3` is Go-only, `claude-opus-4-5` is Zen-only.
    assert_eq!(zen_cache_read("hy3"), Some(0.035));
    assert_eq!(zen_cache_read("claude-opus-4-5"), Some(0.5));
}

/// A model the Go/Zen shelf does not sell still prices its cache reads, at its
/// own input rate — never at zero, which would read as a free model.
#[test]
fn an_unpublished_cache_rate_falls_back_to_the_input_rate() {
    let catalog = od::catalog();
    // `deepseek-v4.1-flash-eco` is `estimate`-sourced and absent from zen.json.
    assert!(zen_cache_read("deepseek-v4.1-flash-eco").is_none());
    let priced = row_cost(&turn("deepseek-v4.1-flash-eco", 0, 0, 1_000_000), &catalog);
    // 1M cache reads at the model's own $0.05 input rate.
    assert!((priced.cost - 0.05).abs() < 1e-9, "{}", priced.cost);
    assert!(priced.cache_estimated);
    assert!(priced.priced);
}

/// `reasoning` is inside `output` for opencode's own accounting, so a row with
/// output 100 must price 100 — not 100+reasoning. The reader never copies it
/// across, and the price takes output as given.
#[test]
fn reasoning_is_not_added_to_output() {
    let catalog = od::catalog();
    let one = row_cost(&turn("deepseek-v4.1-flash", 0, 100, 0), &catalog);
    let expected = 100.0 * 0.6 / 1e6;
    assert!((one.cost - expected).abs() < 1e-12, "{}", one.cost);
}

/// A recorded cost is a fallback for a model the catalogue has never seen — and
/// `cost: 0` from a provider opencode cannot price leaves the turn unpriced
/// rather than free.
#[test]
fn a_recorded_cost_only_covers_an_unknown_model() {
    let catalog = od::catalog();
    let known = Row {
        recorded_cost: 9.0,
        ..turn("deepseek-v4.1-flash", 1_000_000, 0, 0)
    };
    // The catalogue wins over a recorded figure: it is the plan's own rate table.
    assert!((row_cost(&known, &catalog).cost - 0.15).abs() < 1e-9);

    let unknown_zero = Row {
        recorded_cost: 0.0,
        ..turn("no-such-model", 1_000, 100, 0)
    };
    let priced = row_cost(&unknown_zero, &catalog);
    assert!(!priced.priced, "no rate and cost 0 is unpriced, not free");
    assert_eq!(priced.credits, 0.0);

    let unknown_costed = Row {
        recorded_cost: 1.5,
        ..turn("no-such-model", 1_000, 100, 0)
    };
    assert!((row_cost(&unknown_costed, &catalog).cost - 1.5).abs() < 1e-12);
}

/// The window totals carry the cache tokens and the estimate count, so the
/// footnote has something to count.
#[test]
fn the_report_counts_cache_tokens_and_estimates() {
    let catalog = od::catalog();
    let now = 1_800_000_000_000;
    let rows = vec![
        Row {
            at_ms: now - 1_000,
            ..turn("deepseek-v4.1-flash", 10, 1, 5_000)
        },
        Row {
            at_ms: now - 1_000,
            ..turn("deepseek-v4.1-flash-eco", 10, 1, 7_000)
        },
    ];
    let report = window::build(
        &rows,
        &catalog,
        od::DEFAULT_PLAN,
        now,
        Some(now - 86_400_000),
    );
    assert_eq!(report.month.cache_read, 12_000);
    assert_eq!(report.month.requests, 2);
    assert_eq!(report.month.cache_estimated, 1, "only the eco turn");
    assert_eq!(report.month.unpriced, 0);
    assert!(report.month.credits > 0.0);
}
