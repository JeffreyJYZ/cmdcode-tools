// What one model costs, in the shape `core/zen.json` stores it.
//
// A model's `cost.text` becomes one rate row per context tier, then — when a
// time-of-day multiplier applies — two rows per tier, off-peak and peak. A
// `date` or `service_tier` multiplier is not a peak sheet (a scheduled reprice,
// or another service tier), so it is skipped rather than baked in as if it were
// charged today.
use super::payload::{RawCache, RawModel, RawMultiplier, RawOverride, RawRate};
use super::zen::RateVariant;

/// One model's rate variants: the base tier, any context tiers, and the peak
/// sheet when a time-of-day multiplier applies.
pub(super) fn rate_variants(raw: &RawModel) -> Vec<RateVariant> {
    let Some(text) = raw.cost.as_ref().and_then(|cost| cost.text.as_ref()) else {
        return Vec::new();
    };
    let (Some(input), Some(output)) = (text.input.as_ref(), text.output.as_ref()) else {
        return Vec::new();
    };
    // No published input *or* output price means no rate row at all — the model
    // is listed but unpriced, exactly as `extract-zen` skips it.
    if input.price.is_none() || output.price.is_none() {
        return Vec::new();
    }
    let bounds = thresholds(input, output);
    let plain: Vec<RateVariant> = if bounds.is_empty() {
        vec![tier(input, output, None, None, None)]
    } else {
        let mut rows = vec![tier(input, output, None, Some(bounds[0]), None)];
        for (i, gt) in bounds.iter().enumerate() {
            rows.push(tier(
                input,
                output,
                Some(*gt),
                bounds.get(i + 1).copied(),
                Some(*gt),
            ));
        }
        rows
    };
    let multipliers = raw
        .cost
        .as_ref()
        .map(|cost| cost.multipliers.as_slice())
        .unwrap_or_default();
    let Some(factor) = peak_factor(multipliers) else {
        return plain;
    };
    let mut variants: Vec<RateVariant> = Vec::with_capacity(plain.len() * 2);
    for row in &plain {
        variants.push(RateVariant {
            peak: Some("off-peak".into()),
            ..row.clone()
        });
    }
    for row in plain {
        variants.push(RateVariant {
            peak: Some("peak".into()),
            input: round(row.input * factor),
            output: round(row.output * factor),
            cache_read: round(row.cache_read * factor),
            cache_write: round(row.cache_write * factor),
            ..row
        });
    }
    variants
}

/// The context-tier bounds (`overrides[].when.context.gt`), ascending.
fn thresholds(input: &RawRate, output: &RawRate) -> Vec<f64> {
    let mut found: Vec<f64> = Vec::new();
    for rate in [input, output] {
        for over in &rate.overrides {
            let Some(gt) = over
                .when
                .as_ref()
                .and_then(|w| w.context.as_ref())
                .and_then(|c| c.gt)
            else {
                continue;
            };
            if !found.contains(&gt) {
                found.push(gt);
            }
        }
    }
    found.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    found
}

/// The context override naming `gt`, if this rate has one.
fn matching_override(rate: &RawRate, gt: Option<f64>) -> Option<&RawOverride> {
    let gt = gt?;
    rate.overrides.iter().find(|over| {
        over.when
            .as_ref()
            .and_then(|w| w.context.as_ref())
            .and_then(|c| c.gt)
            == Some(gt)
    })
}

/// One tier's rates; `gt` names the override that applies to it, if any.
fn tier(
    input: &RawRate,
    output: &RawRate,
    gt: Option<f64>,
    max: Option<f64>,
    min: Option<f64>,
) -> RateVariant {
    let input_over = matching_override(input, gt);
    let output_over = matching_override(output, gt);
    RateVariant {
        peak: None,
        tier_max_tokens: max.map(|tokens| tokens as u64),
        tier_min_tokens: min.map(|tokens| tokens as u64),
        input: round(
            input_over
                .and_then(|over| over.price)
                .or(input.price)
                .unwrap_or(0.0),
        ),
        output: round(
            output_over
                .and_then(|over| over.price)
                .or(output.price)
                .unwrap_or(0.0),
        ),
        cache_read: round(
            input_over
                .and_then(|over| over.cache.as_ref().and_then(|cache| cache.read))
                .or(input.cache.as_ref().and_then(|cache| cache.read))
                .unwrap_or(0.0),
        ),
        cache_write: round(
            input_over
                .and_then(|over| over.cache.as_ref().and_then(write_rate))
                .or(input.cache.as_ref().and_then(write_rate))
                .unwrap_or(0.0),
        ),
    }
}

/// Cache write is a scalar or a TTL map. `serde_json` sorts object keys rather
/// than keeping document order, so the base rate is taken as the map's
/// **smallest** value: a shorter TTL is the cheaper write, which is the entry
/// `extract-zen` reads first on today's payloads (`{"30m":0.25,"12h":0.5}`).
fn write_rate(cache: &RawCache) -> Option<f64> {
    match cache.write.as_ref()? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::Object(map) => map.values().filter_map(serde_json::Value::as_f64).fold(
            None,
            |best: Option<f64>, value| match best {
                Some(best) if best <= value => Some(best),
                _ => Some(value),
            },
        ),
        _ => None,
    }
}

/// A time-of-day multiplier's factor. `date`/`service_tier` multipliers are a
/// scheduled reprice or another tier, not a peak sheet, so they are skipped.
fn peak_factor(multipliers: &[RawMultiplier]) -> Option<f64> {
    for multiplier in multipliers {
        let Some(when) = multiplier.when.as_ref() else {
            continue;
        };
        let has_days = when
            .utc_days
            .as_ref()
            .is_some_and(|days| !days.days.is_empty());
        if !has_days || when.any.is_none() {
            continue;
        }
        if let Some(factor) = multiplier.factor.filter(|factor| *factor != 1.0) {
            return Some(factor);
        }
    }
    None
}

/// Rates are money per 1M tokens: six decimals is well below any published rate.
fn round(rate: f64) -> f64 {
    (rate * 1e6).round() / 1e6
}
