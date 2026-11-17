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

/// Cache-read rate for a model id, and whether the figure is the fallback rather
/// than a published cache rate.
///
/// `input` is the model's own input rate, used when no published cache rate
/// exists — never zero, which would read as a free model rather than an omission.
pub fn cache_read_rate(input: f64, catalog_id: &str) -> (f64, bool) {
    match zen_cache_read(catalog_id) {
        Some(rate) => (rate, false),
        None => (input, true),
    }
}

/// Cache-read rate for a model, from `core/zen.json`'s row for it.
///
/// `zen.json` is the only table in the repo with a cache-read rate. Where that
/// shelf carries several rate sheets for one model (deepseek's peak/off-peak
/// pair), the cheapest is used: OpenDesign's own price list is flat, so no
/// time-of-day cut applies here and the low sheet is the published floor — the
/// same figure the catalogue's own input/output pair comes from.
///
/// Built once: pricing runs per turn, and re-parsing the catalogue each time cost
/// 19 s on a 2 000-turn store.
pub fn zen_cache_read(model_id: &str) -> Option<f64> {
    static RATES: std::sync::OnceLock<std::collections::HashMap<String, f64>> =
        std::sync::OnceLock::new();
    let rates = RATES.get_or_init(|| {
        let catalog = crate::ocuse::zen::catalog();
        let mut map = std::collections::HashMap::new();
        for model in catalog.go.models.iter().chain(catalog.zen.models.iter()) {
            let cheapest = model
                .variants
                .iter()
                .map(|v| v.cache_read)
                .filter(|rate| *rate > 0.0)
                .min_by(f64::total_cmp);
            if let Some(rate) = cheapest {
                // The same model appears on both shelves with different sheets
                // (deepseek is 0.003 on Go, 0.006 on Zen). The cheapest is the
                // published floor, so a later occurrence must never raise it.
                let entry = map.entry(model.id.clone()).or_insert(rate);
                if rate < *entry {
                    *entry = rate;
                }
            }
        }
        map
    });
    rates.get(model_id).copied()
}
