// The two aggregates the frame and the JSON projection share: a window's totals,
// and one model's totals across every window.
//
// Split from `window::mod` so the file that owns the arithmetic stays under the
// repo's line cap; nothing here knows about plans, periods or the store.
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
    /// Turns in this window the catalogue had no rate for. They count as
    /// requests and their credits are absent, so a total that looks short is
    /// short by exactly this many turns — the dashboard says how many.
    pub unpriced: u64,
}

impl Totals {
    pub(super) fn add(&mut self, row: &Row, cost: f64, credits: f64, priced: bool) {
        self.credits += credits;
        self.cost += cost;
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
        if !priced {
            self.unpriced += 1;
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
