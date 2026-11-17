// The two aggregates the frame and the JSON projection share: a window's totals,
// and one model's totals across every window.
//
// Split from `window::mod` so the file that owns the arithmetic stays under the
// repo's line cap; nothing here knows about plans, periods or stores.
use crate::oduse::db::Row;

#[derive(Debug, Clone, Default)]
pub struct Totals {
    /// The plan's own unit: list-price dollars x each model's multiplier.
    pub credits: f64,
    /// List-price dollars, so the estimate's basis is visible.
    pub cost: f64,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
    /// Cache-read tokens in this window. Priced — they dominate an agent run, and
    /// a zero here would read as a free model rather than an omission.
    pub cache_read: u64,
    /// Turns whose cache reads were priced at the model's input rate because the
    /// catalogue publishes no cache rate for it. Priced all the same; a footnote.
    pub cache_estimated: u64,
    /// Turns in this window the catalogue had no rate for and that recorded no
    /// cost of their own. They count as requests and their credits are absent, so
    /// a total that looks short is short by exactly this many turns.
    pub unpriced: u64,
}

impl Totals {
    /// The same accumulation for a caller that already priced the row (the report
    /// builder prices once and adds the answer to three windows).
    pub(super) fn add_price(&mut self, row: &Row, priced: crate::oduse::price::Priced) {
        self.credits += priced.credits;
        self.cost += priced.cost;
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
        self.cache_read += row.cache_read;
        if !priced.priced {
            self.unpriced += 1;
        }
        if priced.cache_estimated && row.cache_read > 0 {
            self.cache_estimated += 1;
        }
    }

    pub fn tokens(&self) -> u64 {
        self.input + self.output
    }
}

#[derive(Debug, Clone)]
pub struct ModelUsage {
    pub id: String,
    pub multiplier: f64,
    /// False when the catalogue carries no rate for this model: it still counts
    /// requests and tokens, and its credits are absent rather than zero.
    pub priced: bool,
    pub month: Totals,
    pub five_hour: Totals,
    pub weekly: Totals,
}
