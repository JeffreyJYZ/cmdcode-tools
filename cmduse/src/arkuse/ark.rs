// The ARK Agent Plan catalogue: tiers, AFP quota, model coefficients, gates.
//
// Source is `core/ark.json`, hand-maintained from the docs (see the file's own
// `source` URL and `~/dev/rdm/volcengine/research/agent-plan-matrix.md`). Unlike
// `zen.json` this is not generated: the docs publish coefficients as prose
// tables, and a scraper for them would be more fragile than the five fields
// that change.
//
// AFP is the plan's own currency and 1 AFP = ¥0.002 at every tier, so the
// catalogue holds AFP and converts to yuan only for display.
use crate::arkuse::window;
use serde::Deserialize;
use std::collections::BTreeMap;

const RAW: &str = cmduse_core::ARK_JSON;

/// Tier used when nothing names one and no profile answers.
pub const DEFAULT_PLAN: &str = "medium";

#[derive(Debug, Clone, Deserialize)]
pub struct WindowShare {
    #[serde(rename = "fiveHour")]
    pub five_hour: f64,
    pub daily: f64,
    pub weekly: f64,
    pub monthly: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Promo {
    pub price: f64,
    /// `YYYY-MM-DD`, inclusive.
    pub until: String,
    pub months: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Plan {
    pub id: String,
    pub label: String,
    pub scope: String,
    pub rank: u8,
    /// List price in yuan per month.
    pub price: f64,
    #[serde(rename = "listPrice")]
    pub list_price: f64,
    /// Monthly AFP quota.
    pub afp: f64,
    pub promo: Option<Promo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Enterprise {
    pub id: String,
    pub label: String,
    pub price: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub kind: String,
    /// AFP coefficient: `(input + cache_read + output) × coef / 10,000`.
    pub coef: f64,
    #[serde(rename = "promoCoef")]
    pub promo_coef: Option<f64>,
    #[serde(rename = "promoUntil")]
    pub promo_until: Option<String>,
    #[serde(rename = "minPlan")]
    pub min_plan: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Media {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(rename = "minPlan")]
    pub min_plan: String,
    pub unit: String,
    pub coef: f64,
    #[serde(rename = "coefHigh")]
    pub coef_high: Option<f64>,
    #[serde(rename = "promoCoef")]
    pub promo_coef: Option<f64>,
    pub free: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Catalog {
    #[serde(rename = "extractedAt")]
    pub extracted_at: String,
    pub source: String,
    pub currency: String,
    /// Yuan per AFP — 0.002 at every tier.
    #[serde(rename = "afpYuan")]
    pub afp_yuan: f64,
    pub windows: WindowShare,
    pub plans: Vec<Plan>,
    pub enterprise: Vec<Enterprise>,
    pub models: Vec<Model>,
    pub media: Vec<Media>,
    pub harness: Vec<Media>,
    pub notes: BTreeMap<String, String>,
}

/// Parsed once; the file is a compile-time constant.
pub fn catalog() -> Catalog {
    serde_json::from_str(RAW).expect("core/ark.json is hand-maintained; check its JSON")
}

impl Catalog {
    pub fn plan(&self, plan_id: &str) -> Option<&Plan> {
        self.plans.iter().find(|p| p.id == plan_id)
    }

    pub fn plan_ids(&self) -> Vec<&str> {
        self.plans.iter().map(|p| p.id.as_str()).collect()
    }

    /// The tier a model needs, compared by rank so `--plan large` grants a
    /// Medium-only model too.
    pub fn grants(&self, plan_id: &str, min_plan: &str) -> bool {
        match (self.plan(plan_id), self.plan(min_plan)) {
            (Some(have), Some(need)) => have.rank >= need.rank,
            // An unknown minimum is not a gate.
            _ => true,
        }
    }

    /// The coefficient in force at `at_ms`: a promo halves it until its own date.
    pub fn coef_at(&self, model: &Model, at_ms: i64) -> f64 {
        match (model.promo_coef, model.promo_until.as_deref()) {
            (Some(promo), Some(until)) if window::before_day_end(at_ms, until) => promo,
            _ => model.coef,
        }
    }

    /// AFP for one text/embedding turn, or `None` for a model with no
    /// coefficient (unknown, or media which meters in its own unit).
    ///
    /// Cache-read tokens are billed: measured on this account, cache-excluded
    /// arithmetic gave 40.9 AFP against a 706.5 meter, cache-inclusive gave
    /// 705.2 — 0.2% apart.
    pub fn afp(
        &self,
        model_id: &str,
        at_ms: i64,
        input: u64,
        cache_read: u64,
        output: u64,
    ) -> Option<f64> {
        let model = self.models.iter().find(|m| m.id == model_id)?;
        let coef = self.coef_at(model, at_ms);
        let tokens = input as f64 + cache_read as f64 + output as f64;
        Some(tokens * coef / 10_000.0)
    }

    /// The plan's monthly AFP quota.
    pub fn quota(&self, plan_id: &str) -> Option<f64> {
        self.plan(plan_id).map(|p| p.afp)
    }

    /// Yuan for an AFP amount.
    pub fn yuan(&self, afp: f64) -> f64 {
        afp * self.afp_yuan
    }
}

/// The coefficient a model carries right now, with the promo already applied.
/// Public because the model table and the reconciliation both show it.
pub fn effective_coef(model: &Model, at_ms: i64) -> f64 {
    match (model.promo_coef, model.promo_until.as_deref()) {
        (Some(promo), Some(until)) if window::before_day_end(at_ms, until) => promo,
        _ => model.coef,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_has_every_personal_tier() {
        let c = catalog();
        assert_eq!(c.plan_ids(), ["small", "medium", "large", "max"]);
        assert_eq!(c.plan("medium").unwrap().afp, 100_000.0);
        assert!((c.yuan(100_000.0) - 200.0).abs() < 1e-9, "flat ¥0.002/AFP");
    }

    #[test]
    fn cache_read_is_inside_the_afp_formula() {
        let c = catalog();
        let at = window::days_from_civil(2026, 10, 19) * 86_400_000;
        // deepseek-v4.1-flash is on its 1.25 promo until 2026-12-30, so
        // 10,000 input + 10,000 cache + 0 output = 20,000 × 1.25 / 10^4.
        let afp = c.afp("deepseek-v4.1-flash", at, 10_000, 10_000, 0).unwrap();
        assert!((afp - 2.5).abs() < 1e-9, "afp {afp}");
        // After the promo it is the full 2.5 coefficient.
        let later = window::days_from_civil(2027, 1, 2) * 86_400_000;
        let afp = c
            .afp("deepseek-v4.1-flash", later, 10_000, 10_000, 0)
            .unwrap();
        assert!((afp - 5.0).abs() < 1e-9, "afp {afp}");
    }

    #[test]
    fn tiers_gate_models_by_rank() {
        let c = catalog();
        assert!(!c.grants("small", "medium"), "kimi-k3 needs Medium");
        assert!(c.grants("medium", "medium"));
        assert!(c.grants("max", "medium"));
        assert!(!c.grants("small", "large"), "video needs Large");
        assert!(c.grants("large", "large"));
    }
}
