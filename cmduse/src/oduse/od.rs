// The OpenDesign catalogue: what each plan allows and what a model costs.
//
// Hand-maintained in `core/od.json`. Plan caps and multipliers come from the
// pricing prose; token rates, cache rates and long-context tiers come verbatim
// from Open Design's own `GET /v1/public/model-prices` list (the raw payload is
// kept under `docs/plan/opendesign/reference/`). Every row is `published`: the
// list covers every model this table carries, so no rate needs an `estimate`
// label any more. `catalogId` remains only as the old Go/Zen spelling of a wire
// id; pricing keys on the wire id itself.
//
// The table is keyed by the gateway's **wire id**, because a turn records what
// the gateway served — an id the rows do not carry is metered at zero.
//
// Which plan the account is on is not discoverable either: the store records no
// subscription and the daemon's wallet reports a balance, not a tier, so `--plan`
// is told and defaults to [`DEFAULT_PLAN`].
use serde::Deserialize;

// Re-exported from `cmduse-core` so the path stays inside its own crate (an
// `include_str!` reaching outside is fine locally and fatal at `cargo publish`).
const RAW: &str = cmduse_core::OD_JSON;

/// The plan `oduse` measures against when `--plan` is not given.
pub const DEFAULT_PLAN: &str = "go";

#[derive(Debug, Clone, Deserialize)]
pub struct Plan {
    pub id: String,
    pub label: String,
    #[serde(rename = "priceUsd")]
    pub price_usd: f64,
    #[serde(rename = "monthlyUsd")]
    pub monthly_usd: f64,
    /// Published 7-day cap; every plan has one.
    #[serde(rename = "weeklyUsd")]
    pub weekly_usd: Option<f64>,
    /// Published 5-hour cap. Only Go has one — a `None` prints as absent, never
    /// as zero (the other plans do not throttle on a 5-hour basis at all).
    #[serde(rename = "fiveHourUsd")]
    pub five_hour_usd: Option<f64>,
    /// The separate allowance for the plan's own models. Published, but with no
    /// local meter: the store names models, not which of them are plan models.
    #[serde(rename = "planModelCreditsUsd")]
    pub plan_model_credits_usd: f64,
    pub concurrency: u32,
    /// Name of the plan's own cap set when it also publishes overrides (`Eco` on
    /// Go). Absent on a plan with one set, where the plan's caps are the answer.
    #[serde(default, rename = "defaultCapLabel")]
    pub default_cap_label: Option<String>,
    /// Models whose allowance differs from the plan's own caps.
    #[serde(default, rename = "capOverrides")]
    pub cap_overrides: Vec<CapSet>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    /// The gateway's wire id — what `GET /v1/models` returns and what the store
    /// records on a turn. The catalogue is keyed by this, so a recorded turn
    /// always finds its row.
    pub id: String,
    pub label: String,
    /// Legacy spelling of the same model from the Go/Zen catalogue
    /// (`claude-haiku-5-5` where the gateway serves `claude-haiku-5.5`). Kept for
    /// readers and `--json`; no pricing or rate lookup uses it any more — Open
    /// Design's price list is keyed by the wire [`Model::id`] itself.
    #[serde(default, rename = "catalogId")]
    pub catalog_id: Option<String>,
    /// credits = list-price dollars x this multiplier.
    pub multiplier: f64,
    /// `$`/1M input tokens.
    pub input: f64,
    /// `$`/1M output tokens.
    pub output: f64,
    /// `$`/1M cache-read tokens, straight from the published price list. A
    /// missing value means the list has no row for this model, not a free rate.
    #[serde(default, rename = "cacheRead")]
    pub cache_read: Option<f64>,
    /// `$`/1M cache-write tokens. Recorded for completeness: the store has no
    /// cache-write counter, so this cannot change a figure today.
    #[serde(default, rename = "cacheWrite")]
    pub cache_write: Option<f64>,
    /// Published replacement rates for a large turn; absent on a flat-rate
    /// model. The whole turn is repriced once the input threshold is crossed.
    #[serde(default, rename = "longContext")]
    pub long_context: Option<LongContext>,
    /// Provenance of the token rates, with three cases: `published` (Open
    /// Design's own price list — the only authoritative one), `estimate` (a
    /// seeded stand-in, used only where no rate is published), and absent
    /// (`None`, no claim at all). Every current row is `published`; the field is
    /// optional so a row that carries no label still parses and renders as
    /// unlabelled rather than being silently promoted to published.
    #[serde(default, rename = "rateSource")]
    pub rate_source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LongContext {
    /// The published `inputTokensAbove` threshold, in fresh input tokens.
    #[serde(rename = "inputTokensAbove")]
    pub input_tokens_above: u64,
    pub input: f64,
    pub output: f64,
    #[serde(rename = "cacheRead")]
    pub cache_read: f64,
    #[serde(default, rename = "cacheWrite")]
    pub cache_write: Option<f64>,
}

impl Model {
    /// The id to look up in the repo's token catalogue: `catalogId` when the two
    /// tables spell the model differently, else the wire id itself.
    pub fn catalog_id(&self) -> &str {
        self.catalog_id.as_deref().unwrap_or(&self.id)
    }
}

pub use crate::oduse::caps::{CapPick, CapSet};

#[derive(Debug, Clone, Deserialize)]
pub struct Catalog {
    #[serde(rename = "extractedAt")]
    pub extracted_at: String,
    pub source: String,
    /// What a credit is, in one clause — printed by `plans` so the two units on
    /// the dashboard are never guessed at.
    #[serde(rename = "creditUnit")]
    pub credit_unit: String,
    pub notes: Vec<String>,
    pub plans: Vec<Plan>,
    pub models: Vec<Model>,
}

/// Parsed per call; the file is a compile-time constant.
pub fn catalog() -> Catalog {
    serde_json::from_str(RAW).expect("core/od.json is hand-maintained; check its JSON")
}

impl Catalog {
    pub fn plan(&self, plan_id: &str) -> Option<&Plan> {
        self.plans.iter().find(|p| p.id == plan_id)
    }

    pub fn plan_ids(&self) -> Vec<&str> {
        self.plans.iter().map(|p| p.id.as_str()).collect()
    }

    pub fn model(&self, model_id: &str) -> Option<&Model> {
        self.models.iter().find(|m| m.id == model_id)
    }

    /// List-price cost of one turn, or `None` for a model the catalogue does not
    /// carry — the caller then reports it as unpriced rather than free.
    ///
    /// Cache tokens are not counted here; [`Self::turn_cost`] is the turn's real
    /// price. There is no token count in a `price`/`credits` caller to decide a
    /// long-context tier, so those two always use the flat published rate.
    pub fn price(&self, model_id: &str, input: u64, output: u64) -> Option<f64> {
        let model = self.model(model_id)?;
        Some((input as f64 * model.input + output as f64 * model.output) / 1e6)
    }

    /// What one turn costs, with the three things the two stores disagree about
    /// folded in — see [`crate::oduse::price`], which is the one place the rule
    /// lives:
    ///
    /// * **cache reads are priced** at the model's published `cacheRead`, never
    ///   at `core/zen.json`'s rate for a sibling id.
    /// * **a published long-context tier replaces all four rates** once the
    ///   fresh-input threshold is crossed; see the comment in the body.
    /// * **reasoning is not added to output** — opencode bills it inside `output`
    ///   already, and this catalogue has no reasoning rate.
    /// * the result is `None` for a model the catalogue has never seen, which the
    ///   caller reports as unpriced rather than free.
    pub fn turn_cost(
        &self,
        model_id: &str,
        input: u64,
        output: u64,
        cache_read: u64,
    ) -> Option<crate::oduse::price::Priced> {
        let model = self.model(model_id)?;
        // The store's `input` is the fresh-input counter; `cache_read` is a
        // disjoint counter, not a prefix of it, so only `input` can decide a
        // published `inputTokensAbove` tier. Output rides the chosen tier but
        // never selects it. A model without a tier keeps its flat rates.
        let (input_rate, output_rate, published_cache) = match &model.long_context {
            Some(tier) if input > tier.input_tokens_above => {
                (tier.input, tier.output, Some(tier.cache_read))
            }
            _ => (model.input, model.output, model.cache_read),
        };
        let (cache_rate, cache_estimated) =
            crate::oduse::price::cache_read_rate(published_cache, input_rate);
        let cost = (input as f64 * input_rate
            + output as f64 * output_rate
            + cache_read as f64 * cache_rate)
            / 1e6;
        Some(crate::oduse::price::Priced {
            cost,
            credits: cost * model.multiplier,
            priced: true,
            cache_estimated,
        })
    }

    /// The plan's own unit: `price x multiplier`.
    pub fn credits(&self, model_id: &str, input: u64, output: u64) -> Option<f64> {
        let multiplier = self.multiplier(model_id);
        self.price(model_id, input, output)
            .map(|cost| cost * multiplier)
    }

    /// Multiplier in force for a model; 1 for a model the catalogue has never
    /// seen, so an unknown id is not silently discounted or surcharged.
    pub fn multiplier(&self, model_id: &str) -> f64 {
        self.model(model_id).map(|m| m.multiplier).unwrap_or(1.0)
    }
}
