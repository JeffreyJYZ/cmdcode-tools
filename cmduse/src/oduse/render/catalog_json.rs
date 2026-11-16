// The machine-readable catalogue: `oduse plans --json` and `oduse models --json`.
//
// Split from the text renderers so each file stays one surface, and so the two
// spellings the family shares live together: `windows` is the same divisor map
// ocuse and arkuse publish, and a model's display name is `name` everywhere the
// model row is a whole object (`plans[]` keeps `label`, which is the plan row's
// own spelling on all four binaries).
use crate::oduse::od::Plan;

/// Each window's share of the monthly allowance, so a consumer that reads
/// `windows` gets an answer on all four binaries. Only Go publishes a 5-hour
/// cap, so Go is the plan the share is taken from. Rounded to four decimals,
/// which costs at most 2 cents on the $220 month.
fn window_share() -> serde_json::Value {
    let catalog = crate::oduse::od::catalog();
    let go = catalog.plan("go");
    let monthly = go
        .map(|p| p.monthly_usd)
        .filter(|v| *v > 0.0)
        .unwrap_or(1.0);
    let share = |v: Option<f64>| {
        v.map(|v| (v / monthly * 10_000.0).round() / 10_000.0)
            .unwrap_or(1.0)
    };
    serde_json::json!({
        "fiveHour": share(go.and_then(|p| p.five_hour_usd)),
        "weekly": share(go.and_then(|p| p.weekly_usd)),
        "monthly": 1.0,
    })
}

/// The catalogue as one JSON object — the machine twin of `plans_text`: plans
/// with their caps, the credit unit, and the rate table with its provenance.
pub fn plans_json() -> String {
    let catalog = crate::oduse::od::catalog();
    let plan_json = |plan: &Plan| {
        serde_json::json!({
            "id": plan.id,
            "label": plan.label,
            "priceUsd": plan.price_usd,
            "monthlyUsd": plan.monthly_usd,
            "weeklyUsd": plan.weekly_usd,
            "fiveHourUsd": plan.five_hour_usd,
            "planModelCreditsUsd": plan.plan_model_credits_usd,
            "concurrency": plan.concurrency,
        })
    };
    serde_json::json!({
        "extractedAt": catalog.extracted_at,
        "source": catalog.source,
        "creditUnit": catalog.credit_unit,
        "windows": window_share(),
        "notes": catalog.notes,
        "plans": catalog.plans.iter().map(plan_json).collect::<Vec<_>>(),
        "models": catalog.models.iter().map(|m| serde_json::json!({
            "id": m.id,
            "name": m.label,
            "catalogId": m.catalog_id,
            "multiplier": m.multiplier,
            "input": m.input,
            "output": m.output,
            "rateSource": m.rate_source,
        })).collect::<Vec<_>>(),
    })
    .to_string()
}

/// `oduse models --json`: one object per line, like `cmduse models --json`.
pub fn models_json(plan_id: &str) -> String {
    let catalog = crate::oduse::od::catalog();
    let plan = catalog.plan(plan_id);
    let mut out = String::new();
    for model in &catalog.models {
        out.push_str(
            &serde_json::json!({
                "id": model.id,
                "name": model.label,
                "catalogId": model.catalog_id,
                "multiplier": model.multiplier,
                "input": model.input,
                "output": model.output,
                "rateSource": model.rate_source,
                "plan": plan.map(|p| p.id.clone()),
                "monthCapUsd": plan.map(|p| p.monthly_usd),
                "fiveHourCapUsd": plan.and_then(|p| p.five_hour_usd),
                "weeklyCapUsd": plan.and_then(|p| p.weekly_usd),
            })
            .to_string(),
        );
        out.push('\n');
    }
    out
}
