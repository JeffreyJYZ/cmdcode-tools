// The OpenDesign catalogue: what each plan allows and what a model costs.
//
// Hand-maintained in `core/od.json` from the plan page, because Open Design
// publishes its caps as prose — there is no machine-readable source to extract
// from. Token rates are taken from the repo's own model catalogue where the id
// appears there (`rateSource: "repo"`): `core/zen.json` first, and for an id that
// shop does not sell, `opencode-plugin/src/catalog.ts` (generated from the
// published CLI bundle). Every figure the plan page does not publish is marked
// `estimate` so `oduse models` can say which is which.
//
// The table is keyed by the gateway's **wire id**, because a turn records what
// the gateway served — an id the rows do not carry is metered at zero. Where the
// Go/Zen shelf spells the same model differently, `catalogId` names it there and
// only the provenance lookup reads that.
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
}

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    /// The gateway's wire id — what `GET /v1/models` returns and what the store
    /// records on a turn. The catalogue is keyed by this, so a recorded turn
    /// always finds its row.
    pub id: String,
    pub label: String,
    /// The same model's id in the repo's token catalogue (`core/zen.json`) where
    /// that table spells it differently — the shelf writes `claude-haiku-5-5`
    /// where the gateway serves `claude-haiku-5.5`. Only the provenance lookup
    /// uses it; pricing keys on [`Model::id`].
    #[serde(default, rename = "catalogId")]
    pub catalog_id: Option<String>,
    /// credits = list-price dollars x this multiplier.
    pub multiplier: f64,
    /// `$`/1M input tokens.
    pub input: f64,
    /// `$`/1M output tokens.
    pub output: f64,
    /// `repo` when the rate comes from the repo's own model catalogue
    /// (`core/zen.json`, else `opencode-plugin/src/catalog.ts`), `estimate`
    /// otherwise.
    #[serde(rename = "rateSource")]
    pub rate_source: String,
}

impl Model {
    /// The id to look up in the repo's token catalogue: `catalogId` when the two
    /// tables spell the model differently, else the wire id itself.
    pub fn catalog_id(&self) -> &str {
        self.catalog_id.as_deref().unwrap_or(&self.id)
    }
}

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
    /// price (it also takes `cache_read`), and this stays the bare input/output
    /// form the catalogue's own rows are stated in.
    pub fn price(&self, model_id: &str, input: u64, output: u64) -> Option<f64> {
        let model = self.model(model_id)?;
        Some((input as f64 * model.input + output as f64 * model.output) / 1e6)
    }

    /// What one turn costs, with the three things the two stores disagree about
    /// folded in — see [`crate::oduse::price`], which is the one place the rule
    /// lives:
    ///
    /// * **cache reads are priced.** `core/od.json` carries no cache rate, so the
    ///   rate comes from `core/zen.json`'s row for the same model (`catalogId`,
    ///   else the wire id), and a model that shelf does not sell prices cache
    ///   reads at its own input rate.
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
        let (cache_rate, cache_estimated) =
            crate::oduse::price::cache_read_rate(model.input, model.catalog_id());
        let cost = (input as f64 * model.input
            + output as f64 * model.output
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
