// The catalogues: `oduse plans` (the plan table) and `oduse models` (the rate
// table for one plan).
//
// No plan is marked as current: the store records no subscription and the
// daemon's wallet reports a balance, so the plan is the one `--plan` named and
// the heading says so rather than guessing.
use crate::oduse::od::{Catalog, Plan};
use cmduse_core::money;

use super::ink::Ink;

/// Every plan's price, caps and concurrency, then what a credit is, then the
/// rate table with the multiplier and whether the rate is published or an
/// estimate.
pub fn plans_text(colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = crate::oduse::od::catalog();
    let mut out = format!(
        "{}OpenDesign plans{} {}\n",
        ink.bold,
        ink.reset,
        ink.dim_on(format!(
            "(hand-maintained, updated {})",
            catalog.extracted_at
        )),
    );
    out.push_str(&format!(
        "{}windows: monthly 100%, and a 7-day cap on every plan; a 5-hour cap on Go only{} {}\n",
        ink.dim,
        ink.reset,
        ink.dim_on(format!("· {}", catalog.credit_unit)),
    ));
    out.push_str(&format!(
        "\n{}{:<6} {:>8} {:>9} {:>8} {:>8} {:>8} {:>4}{}\n",
        ink.bold, "PLAN", "PRICE", "MONTHLY", "WEEKLY", "5-HOUR", "MODELS", "CONC", ink.reset
    ));
    for plan in &catalog.plans {
        let cap = |v: Option<f64>| match v {
            Some(v) => ink.cyan_on(format!("{:>8}", money(v))),
            // Not published for this plan: absent, never $0.
            None => ink.dim_on(format!("{:>8}", "—")),
        };
        out.push_str(&format!(
            "{:<6} {} {} {} {} {} {:>4}\n",
            plan.label,
            ink.cyan_on(format!("{:>8}", format!("${:.0}/mo", plan.price_usd))),
            ink.cyan_on(format!("{:>9}", money(plan.monthly_usd))),
            cap(plan.weekly_usd),
            cap(plan.five_hour_usd),
            match plan.plan_model_credits_usd {
                0.0 => ink.dim_on(format!("{:>8}", "—")),
                v => ink.cyan_on(format!("{:>8}", money(v))),
            },
            plan.concurrency,
        ));
    }
    out.push_str(&format!(
        "{}MODELS = credits included for the plan's own models, with no local meter.{}",
        ink.dim, ink.reset
    ));
    out.push_str(&models_table(&ink, &catalog));
    out.push_str(&notes(&ink, &catalog));
    out
}

/// Every model's multiplier and `$`/1M rates, one row each.
fn models_table(ink: &Ink, catalog: &Catalog) -> String {
    let mut out = format!(
        "\n{}{:<30} {:>4} {:>7} {:>7} {:>9}{}\n",
        ink.bold, "MODEL", "MULT", "IN", "OUT", "RATE", ink.reset
    );
    for model in &catalog.models {
        out.push_str(&format!(
            "{:<30} {:>4} {} {} {}\n",
            model.id,
            format!("x{}", trim(model.multiplier)),
            ink.cyan_on(format!("{:>7}", format!("${}", model.input))),
            ink.cyan_on(format!("{:>7}", format!("${}", model.output))),
            if model.rate_source == "repo" {
                ink.dim_on(format!("{:>9}", "published"))
            } else {
                ink.dim_on(format!("{:>9}", "estimate"))
            },
        ));
    }
    out
}

fn notes(ink: &Ink, catalog: &Catalog) -> String {
    let mut out = String::new();
    for note in &catalog.notes {
        out.push_str(&format!("\n{}{note}{}", ink.dim, ink.reset));
    }
    out.push('\n');
    out
}

/// `0.5` not `0.50`, `1` not `1.0`.
fn trim(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if (rounded - rounded.round()).abs() < f64::EPSILON {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded}")
    }
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
        "notes": catalog.notes,
        "plans": catalog.plans.iter().map(plan_json).collect::<Vec<_>>(),
        "models": catalog.models.iter().map(|m| serde_json::json!({
            "id": m.id,
            "label": m.label,
            "catalogId": m.catalog_id,
            "multiplier": m.multiplier,
            "input": m.input,
            "output": m.output,
            "rateSource": m.rate_source,
        })).collect::<Vec<_>>(),
    })
    .to_string()
}

/// `oduse models`: the rate table for one plan — every model's multiplier and
/// `$`/1M rates, with that plan's caps as the heading. There is no `gated` view:
/// OpenDesign does not restrict which models a plan may call, it only prices them
/// differently, so a gating flag would invent a restriction.
pub fn models_text(plan_id: &str, colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = crate::oduse::od::catalog();
    let plan = catalog.plan(plan_id);
    let label = plan
        .map(|p| p.label.clone())
        .unwrap_or_else(|| plan_id.to_string());
    let mut out = format!(
        "{}{label} models{} {}\n",
        ink.bold,
        ink.reset,
        ink.dim_on(format!(
            "({} models · {} · credits = list-price $ x multiplier)",
            catalog.models.len(),
            plan.map(|p| format!("{}/mo cap", money(p.monthly_usd)))
                .unwrap_or_default()
        )),
    );
    let table = models_table(&ink, &catalog);
    // `models_table` opens with a blank line for its `plans` caller, which puts
    // it under the plan table; here it sits under the heading instead.
    out.push_str(table.strip_prefix('\n').unwrap_or(&table));
    out
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
                "label": model.label,
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
