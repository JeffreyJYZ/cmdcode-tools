// What one turn costs, in one place.
//
// The dashboard, the buckets, the session table and the model report all price
// the same rows, so the rule lives here once rather than four times:
//
// * price from the catalogue (it knows the model's rates and multiplier, and
//   prices cache reads — see `Catalog::turn_cost`);
// * fall back to the turn's own recorded cost only for a model the catalogue has
//   never seen. opencode writes a `cost`, but it cannot price this provider — 1405
//   of 1419 rows on the reference machine carry `cost: 0` — so it is a fallback,
//   never the primary figure;
// * a row with neither is unpriced: it counts as a request and contributes no
//   credits, and the report says how many.
use crate::oduse::db::Row;
use crate::oduse::od::Catalog;

#[derive(Debug, Clone, Copy, Default)]
pub struct Priced {
    /// List-price dollars.
    pub cost: f64,
    /// The plan's unit: `cost x the model's multiplier`.
    pub credits: f64,
    /// False when nothing could price this turn.
    pub priced: bool,
    /// True when cache reads were priced at the model's input rate because the
    /// catalogue publishes no cache rate for it. Still priced; a footnote.
    pub cache_estimated: bool,
}

pub fn row_cost(row: &Row, catalog: &Catalog) -> Priced {
    if let Some(price) = catalog.turn_cost(&row.model, row.input, row.output, row.cache_read) {
        return Priced {
            cost: price.cost,
            credits: price.credits,
            priced: true,
            cache_estimated: price.cache_estimated,
        };
    }
    if row.recorded_cost > 0.0 {
        return Priced {
            cost: row.recorded_cost,
            credits: row.recorded_cost * catalog.multiplier(&row.model),
            priced: true,
            cache_estimated: true,
        };
    }
    Priced::default()
}

/// Cache-read rate for one row, and whether it had to be inferred.
///
/// Open Design's own price list publishes `cacheRead` for every model in
/// `core/od.json`, so the published rate always wins here. `core/zen.json` is no
/// longer consulted: its floor is a different shelf's off-peak rate and got the
/// cache term wrong for most rows (cache is ~99% of this workload's token mass).
///
/// The fallback is only for a row the list does not carry, which can happen if a
/// model is added to the store before its row reaches the table. It uses that
/// row's own input rate — never zero, which would read as a free model rather
/// than an omission — and reports `true` so the footer can say how many turns
/// were estimated.
pub fn cache_read_rate(published: Option<f64>, input: f64) -> (f64, bool) {
    match published {
        Some(rate) => (rate, false),
        None => (input, true),
    }
}
