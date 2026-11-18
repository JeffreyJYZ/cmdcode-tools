// What one turn costs: published cache rates, reasoning never double-counted,
// `cost: 0` never zeroing a figure, and the multiplier applied once.
use crate::oduse::db::Row;
use crate::oduse::price::{cache_read_rate, row_cost};
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

/// Published DeepSeek V4.1 Flash: `$0.3` in, `$1.2` out, `$0.006` cache read per
/// 1M, x0.5. One million of each is `$1.506` list, `0.753` credits — the cache
/// term is 0.4% of this synthetic turn but ~99% of a real run's token mass.
#[test]
fn cache_reads_are_priced_from_the_published_rate() {
    let catalog = od::catalog();
    let priced = row_cost(
        &turn("deepseek-v4.1-flash", 1_000_000, 1_000_000, 1_000_000),
        &catalog,
    );
    assert!((priced.cost - 1.506).abs() < 1e-9, "{}", priced.cost);
    assert!((priced.credits - 0.753).abs() < 1e-9, "{}", priced.credits);
    assert!(priced.priced);
    assert!(
        !priced.cache_estimated,
        "a published rate is not an estimate"
    );
}

/// The published `$0.006` wins over the old `$0.003` zen floor. DeepSeek's cache
/// reads dominate the bill, so picking the sibling shelf's rate halved every
/// credit figure; no shelf other than Open Design's own list is consulted now.
#[test]
fn the_cache_rate_is_the_models_own_published_rate() {
    let catalog = od::catalog();
    let priced = row_cost(&turn("deepseek-v4.1-flash", 0, 0, 1_000_000), &catalog);
    assert!((priced.cost - 0.006).abs() < 1e-9, "{}", priced.cost);
    assert!(!priced.cache_estimated);
    assert_eq!(cache_read_rate(Some(0.006), 0.3), (0.006, false));
}

/// A flat-rate row still publishes its own cache rate: MiniMax is `$0.15` in and
/// `$0.015` cache, so the old input-rate fallback would have overstated it 10x.
#[test]
fn a_flat_row_uses_its_published_cache_rate() {
    let catalog = od::catalog();
    let priced = row_cost(&turn("minimax-m3.1-flash", 0, 0, 1_000_000), &catalog);
    assert!((priced.cost - 0.015).abs() < 1e-9, "{}", priced.cost);
    assert!(!priced.cache_estimated);
}

/// The fallback survives for a row the list does not yet carry. It prefers that
/// row's own input rate and stays flagged, never zero and never silent.
#[test]
fn an_absent_cache_rate_falls_back_to_the_input_rate() {
    assert_eq!(cache_read_rate(None, 0.05), (0.05, true));
    let catalog = od::catalog();
    let unknown = Row {
        recorded_cost: 1.0,
        ..turn("no-such-model", 0, 0, 1_000_000)
    };
    assert!(row_cost(&unknown, &catalog).cache_estimated);
}

/// `reasoning` is inside `output` for opencode's own accounting, so a row with
/// output 100 prices 100 — not 100+reasoning. The reader never copies it across.
#[test]
fn reasoning_is_not_added_to_output() {
    let catalog = od::catalog();
    let one = row_cost(&turn("deepseek-v4.1-flash", 0, 100, 0), &catalog);
    let expected = 100.0 * 1.2 / 1e6;
    assert!((one.cost - expected).abs() < 1e-12, "{}", one.cost);
}

/// A recorded cost is a fallback for a model the catalogue has never seen — and
/// `cost: 0` from a provider opencode cannot price leaves the turn unpriced.
#[test]
fn a_recorded_cost_only_covers_an_unknown_model() {
    let catalog = od::catalog();
    let known = Row {
        recorded_cost: 9.0,
        ..turn("deepseek-v4.1-flash", 1_000_000, 0, 0)
    };
    // The catalogue wins over a recorded figure: it is the plan's own rate table.
    assert!((row_cost(&known, &catalog).cost - 0.3).abs() < 1e-9);

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
/// footnote has something to count. Every catalogue row now has a published
/// cache rate; only the unknown model's recorded-cost fallback is estimated.
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
        Row {
            at_ms: now - 1_000,
            recorded_cost: 1.0,
            ..turn("no-such-model", 0, 0, 1_000)
        },
    ];
    let report = window::build(
        &rows,
        &catalog,
        od::DEFAULT_PLAN,
        now,
        Some(now - 86_400_000),
    );
    assert_eq!(report.month.cache_read, 13_000);
    assert_eq!(report.month.requests, 3);
    assert_eq!(report.month.cache_estimated, 1, "only the unknown row");
    assert_eq!(report.month.unpriced, 0);
    assert!(report.month.credits > 0.0);
}
