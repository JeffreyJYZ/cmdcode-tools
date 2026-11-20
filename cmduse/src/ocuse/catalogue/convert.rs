// The endpoint's payload -> the catalogue the rest of the crate reads.
//
// One converter, mirroring `scripts/extract-zen.ts` field for field, so a live
// fetch and the baked file cannot mean two different things: the same rate
// variants (context tiers, the peak sheet), the same plan discovery
// (`go.monthly_usage`), the same rounding. Values the endpoint does not publish
// — each plan's price and the window split — are taken from the seed, and the
// plan dimension is discovered from the payload rather than hardcoded, so a plan
// upstream adds or retires arrives without a release here.
use super::payload::{Payload, RawModel};
use super::rates::rate_variants;
use super::zen::{Catalog, Go, GoPlan, Model};
use std::collections::{BTreeMap, BTreeSet};

/// The payload -> a [`Catalog`]. `Err` names why a body was not usable, so the
/// caller can print it beside the builtin fallback.
pub fn convert(body: &str, seed: &Catalog, now_ms: i64) -> Result<Catalog, String> {
    let payload: Payload =
        serde_json::from_str(body).map_err(|e| format!("catalogue: payload: {e}"))?;
    let models = models(&payload.data);
    if models.is_empty() {
        return Err("catalogue: endpoint published no priced model".into());
    }
    let plans = plans(&payload.data, &models, seed)?;
    Ok(Catalog {
        extracted_at: cmduse_core::dates::iso_instant(now_ms.div_euclid(1000).max(0) as u64),
        go: Go {
            // A model's $/month price and the window split are the docs' — the
            // endpoint carries neither.
            window_share: seed.go.window_share.clone(),
            models,
            plans,
        },
        // `/zen/go/v1/models` is the Go endpoint; Zen is a second one, so its
        // rows stay from the seed until that is fetched too.
        zen: seed.zen.clone(),
    })
}

/// Every priced model, sorted by id (the file's own order, so a diff is stable).
fn models(data: &[RawModel]) -> Vec<Model> {
    let mut models: Vec<Model> = data
        .iter()
        .filter(|raw| !raw.id.is_empty())
        .filter_map(|raw| {
            let variants = rate_variants(raw);
            (!variants.is_empty()).then(|| Model {
                id: raw.id.clone(),
                name: raw
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .unwrap_or(&raw.id)
                    .to_string(),
                variants,
            })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

/// Every plan the payload's `go.monthly_usage` keys name, with its allowances.
fn plans(
    data: &[RawModel],
    models: &[Model],
    seed: &Catalog,
) -> Result<BTreeMap<String, GoPlan>, String> {
    let mut ids: BTreeSet<&str> = BTreeSet::new();
    for raw in data {
        let Some(usage) = raw.go.as_ref().and_then(|go| go.monthly_usage.as_ref()) else {
            continue;
        };
        for (id, limit) in usage {
            if limit.is_some() {
                ids.insert(id.as_str());
            }
        }
    }
    if ids.is_empty() {
        return Err("catalogue: no plan published a per-model limit".into());
    }
    let mut plans = BTreeMap::new();
    for id in ids {
        let mut allowance = BTreeMap::new();
        for model in models {
            let limit = data
                .iter()
                .find(|raw| raw.id == model.id)
                .and_then(|raw| raw.go.as_ref())
                .and_then(|go| go.monthly_usage.as_ref())
                .and_then(|usage| usage.get(id).copied().flatten());
            if let Some(limit) = limit.filter(|limit| *limit > 0.0) {
                allowance.insert(model.id.clone(), limit);
            }
        }
        if allowance.is_empty() {
            continue;
        }
        // A plan the seed already knows keeps its documented price and label; a
        // plan the endpoint has added gets a derived label and no price, which
        // prints as unknown rather than as a made-up $0.
        let known = seed.go.plans.get(id);
        plans.insert(
            id.to_string(),
            GoPlan {
                label: known
                    .map(|plan| plan.label.clone())
                    .unwrap_or_else(|| humanize(id)),
                price_usd: known.map(|plan| plan.price_usd).unwrap_or(0.0),
                allowance_by_model: allowance,
            },
        );
    }
    if plans.is_empty() {
        return Err("catalogue: every plan came back without limits".into());
    }
    Ok(plans)
}

/// "go-teams" -> "Go Teams", for a plan the seed has never seen.
fn humanize(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
