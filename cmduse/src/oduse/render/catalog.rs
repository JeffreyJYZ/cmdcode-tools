// The catalogue tables: `oduse plans` and `oduse models`, both in text form.
//
// No plan is marked as current: the store records no subscription and the
// daemon's wallet reports a balance, so the plan is the one `--plan` named and
// the heading says so rather than guessing.
use crate::oduse::od::Catalog;
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

/// `oduse models`: the rate table for one plan — every model's multiplier and
/// `$`/1M rates, with that plan's caps as the heading. There is no `gated` view:
/// OpenDesign does not restrict which models a plan may call, it only prices them
/// differently, so a gating flag would invent a restriction.
pub fn models_text(plan_id: &str, colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = crate::oduse::od::catalog();
    let plan = catalog.plan(plan_id);
    let label: String = plan
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

/// `0.5` not `0.50`, `1` not `1.0`.
fn trim(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if (rounded - rounded.round()).abs() < f64::EPSILON {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded}")
    }
}
