// The report surfaces — `daily`, `hourly`, `session`, `model` — over the app's
// store. Same envelopes the family pins (`REPORT_*_KEYS`), with `credits` beside
// `costUsd` because this binary meters the plan's unit and keeps the list-price
// dollars that produced it.
pub mod bucket;
pub mod model;
pub mod session;

pub use bucket::bucket_text;
pub use model::{model_report, model_text};
pub use session::session_text;

/// Per-key totals, in the family's vocabulary plus this binary's own unit.
pub fn totals_json(
    cost: f64,
    credits: f64,
    requests: u64,
    input: u64,
    output: u64,
) -> serde_json::Value {
    serde_json::json!({
        "requests": requests,
        "tokensIn": input,
        "tokensOut": output,
        "costUsd": cost,
        "credits": credits,
    })
}

/// One day/hour/session bucket, kept apart per column so CSV and JSON never
/// re-derive it from a packed tuple.
#[derive(Default, Clone, Copy)]
pub struct Bucket {
    pub cost: f64,
    pub credits: f64,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
}

impl Bucket {
    pub fn add(&mut self, row: &crate::oduse::db::Row, catalog: &crate::oduse::od::Catalog) {
        let cost = catalog
            .price(&row.model, row.input, row.output)
            .unwrap_or(0.0);
        self.cost += cost;
        self.credits += cost * catalog.multiplier(&row.model);
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
    }

    pub fn merge(&mut self, other: &Bucket) {
        self.cost += other.cost;
        self.credits += other.credits;
        self.requests += other.requests;
        self.input += other.input;
        self.output += other.output;
    }

    pub fn json(&self) -> serde_json::Value {
        totals_json(
            self.cost,
            self.credits,
            self.requests,
            self.input,
            self.output,
        )
    }
}

/// Clip a display name to its column so a long project title cannot shift the
/// numbers behind it.
pub fn truncate(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_string();
    }
    text.chars()
        .take(width.saturating_sub(1))
        .collect::<String>()
        + "…"
}
