// The endpoint's payload, as it arrives — the fields this crate reads.
//
// Only what `/zen/go/v1/models` publishes per model is modelled: `cost.text`
// (with its cache rates and context overrides) and the time-of-day multipliers,
// plus `go.monthly_usage` (model -> plan id -> monthly dollar limit). Anything
// else in the body — modalities, API endpoints, descriptions — is not ours to
// interpret. Every field is optional because the shape is not ours: a field that
// disappears must degrade to "not published", never to a parse failure.
//
// `pub(super)` throughout: the sibling modules `convert` and `rates` read these
// structs, and a private field would not cross the module boundary.
use serde::Deserialize;
use std::collections::BTreeMap;

/// One `GET /zen/go/v1/models` body: `{object, data: [model, …]}`.
#[derive(Deserialize)]
pub(super) struct Payload {
    pub(super) data: Vec<RawModel>,
}

#[derive(Deserialize)]
pub(super) struct RawModel {
    pub(super) id: String,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) cost: Option<RawCost>,
    #[serde(default)]
    pub(super) go: Option<RawGo>,
}

#[derive(Deserialize)]
pub(super) struct RawCost {
    #[serde(default)]
    pub(super) text: Option<RawText>,
    #[serde(default)]
    pub(super) multipliers: Vec<RawMultiplier>,
}

#[derive(Deserialize)]
pub(super) struct RawText {
    #[serde(default)]
    pub(super) input: Option<RawRate>,
    #[serde(default)]
    pub(super) output: Option<RawRate>,
}

#[derive(Deserialize)]
pub(super) struct RawRate {
    #[serde(default)]
    pub(super) price: Option<f64>,
    #[serde(default)]
    pub(super) cache: Option<RawCache>,
    #[serde(default)]
    pub(super) overrides: Vec<RawOverride>,
}

#[derive(Deserialize)]
pub(super) struct RawCache {
    #[serde(default)]
    pub(super) read: Option<f64>,
    /// A scalar, or a TTL map (`{"30m": 0.25, "12h": 0.5}`).
    #[serde(default)]
    pub(super) write: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub(super) struct RawOverride {
    #[serde(default)]
    pub(super) when: Option<RawWhen>,
    #[serde(default)]
    pub(super) price: Option<f64>,
    #[serde(default)]
    pub(super) cache: Option<RawCache>,
}

#[derive(Deserialize)]
pub(super) struct RawWhen {
    #[serde(default)]
    pub(super) context: Option<RawContext>,
}

#[derive(Deserialize)]
pub(super) struct RawContext {
    #[serde(default)]
    pub(super) gt: Option<f64>,
}

#[derive(Deserialize)]
pub(super) struct RawMultiplier {
    #[serde(default)]
    pub(super) when: Option<RawMulWhen>,
    #[serde(default)]
    pub(super) factor: Option<f64>,
}

#[derive(Deserialize)]
pub(super) struct RawMulWhen {
    #[serde(default)]
    pub(super) utc_days: Option<RawDays>,
    #[serde(default)]
    pub(super) any: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
pub(super) struct RawDays {
    #[serde(default, rename = "in")]
    pub(super) days: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct RawGo {
    /// plan id -> monthly dollar limit (`null` on a free model).
    #[serde(default)]
    pub(super) monthly_usage: Option<BTreeMap<String, Option<f64>>>,
}
