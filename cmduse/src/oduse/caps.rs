// Per-model cap sets. OpenDesign's Design Plan publishes model-dependent
// allowances: Go gives DeepSeek V4.1 Flash Eco $220/mo, $55/7d, $18/5h but the
// original DeepSeek V4.1 Flash only $120/mo, $30/7d, $10/5h. A plan's own caps
// are its default set; `capOverrides` in core/od.json names the models with a
// different one. Everything that divides credits by a cap asks this module.
use serde::Deserialize;

use super::od::Plan;

/// One published set of allowances, for one model class.
#[derive(Debug, Clone, Deserialize)]
pub struct CapSet {
    /// Machine key used for comparisons (`eco`, `flash`). Display casing lives
    /// in `label`, so a caller comparing ids never has to match it.
    #[serde(default)]
    pub id: String,
    /// Short name printed beside the figure (`Eco`, `Flash`).
    #[serde(default)]
    pub label: String,
    #[serde(rename = "monthlyUsd")]
    pub monthly_usd: f64,
    #[serde(rename = "weeklyUsd")]
    pub weekly_usd: Option<f64>,
    #[serde(rename = "fiveHourUsd")]
    pub five_hour_usd: Option<f64>,
    /// Wire ids this set applies to. Empty on a plan-level default set.
    #[serde(default)]
    pub models: Vec<String>,
}

/// The set a window is measured against, plus the one it would have got under
/// the plan's default — so a mixed window can name both figures instead of
/// silently charging every turn against the wrong pool.
#[derive(Debug, Clone)]
pub struct CapPick {
    pub chosen: CapSet,
    /// The plan's own set, present only when it is looser than `chosen` (i.e. an
    /// override won). `None` on a plan with a single published set.
    pub looser: Option<CapSet>,
}

impl Plan {
    /// The plan's own published caps as a set — the answer on every plan with one
    /// set, and the default on Go.
    pub fn default_cap_set(&self) -> CapSet {
        let label = self
            .default_cap_label
            .clone()
            .unwrap_or_else(|| self.label.clone());
        CapSet {
            id: label.to_lowercase(),
            label,
            monthly_usd: self.monthly_usd,
            weekly_usd: self.weekly_usd,
            five_hour_usd: self.five_hour_usd,
            models: Vec::new(),
        }
    }

    /// The set that applies to one model: its own override when the plan
    /// publishes one for it, else the plan's default.
    pub fn cap_set_for(&self, model_id: &str) -> CapSet {
        self.cap_overrides
            .iter()
            .find(|set| set.models.iter().any(|m| m == model_id))
            .cloned()
            .unwrap_or_else(|| self.default_cap_set())
    }

    /// The set a window is measured against when it holds these models: the
    /// **stricter** applicable allowance, so a window mixing a discounted model
    /// with a full-price one cannot borrow the discount. Ties keep the first
    /// (the plan's default) so the frame stays stable.
    ///
    /// The monthly cap is the discriminator — it is the one every plan publishes
    /// — then the 7-day, then the 5-hour figure, so two sets that agree monthly
    /// still resolve.
    pub fn cap_pick(&self, models: &[&str]) -> CapPick {
        let mut sets: Vec<CapSet> = Vec::new();
        for id in models {
            let set = self.cap_set_for(id);
            if !sets.iter().any(|s| s.id == set.id) {
                sets.push(set);
            }
        }
        if sets.is_empty() {
            return CapPick {
                chosen: self.default_cap_set(),
                looser: None,
            };
        }
        sets.sort_by(|a, b| {
            a.monthly_usd
                .total_cmp(&b.monthly_usd)
                .then_with(|| {
                    a.weekly_usd
                        .unwrap_or(0.0)
                        .total_cmp(&b.weekly_usd.unwrap_or(0.0))
                })
                .then_with(|| {
                    a.five_hour_usd
                        .unwrap_or(0.0)
                        .total_cmp(&b.five_hour_usd.unwrap_or(0.0))
                })
        });
        let chosen = sets.remove(0);
        let default = self.default_cap_set();
        // The plan's own set is worth naming only when it is the looser one; a
        // single-set plan has nothing to disambiguate.
        let looser = default
            .monthly_usd
            .gt(&chosen.monthly_usd)
            .then_some(default);
        CapPick { chosen, looser }
    }
}
