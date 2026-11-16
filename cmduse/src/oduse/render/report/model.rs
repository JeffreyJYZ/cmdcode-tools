// `oduse model`: the per-model projection of a report, or one model in detail.
use crate::oduse::window::Report;
use crate::report_render::Fmt;
use cmduse_core::money;

use super::super::ink::Ink;
use super::totals_json;

/// `Json` is the family's `{scope, source, since, sinceMs, models}` envelope,
/// with `multiplier`/`priced` added and no `limit` — the caps belong to the plan,
/// not to a model. `Csv` is one row per model; the `Table` form is the caller's
/// (it needs the db path and row cap, or the single-model detail).
pub fn model_report(report: &Report, id: Option<&str>, fmt: Fmt) -> String {
    let models: Vec<_> = report
        .models
        .iter()
        .filter(|m| id.is_none_or(|want| m.id == want))
        .collect();
    match fmt {
        Fmt::Json => {
            let map: serde_json::Map<String, serde_json::Value> = models
                .iter()
                .map(|m| {
                    let mut body = totals_json(
                        m.month.cost,
                        m.month.credits,
                        m.month.requests,
                        m.month.input,
                        m.month.output,
                    );
                    body["multiplier"] = serde_json::json!(m.multiplier);
                    body["priced"] = serde_json::json!(m.priced);
                    (m.id.clone(), body)
                })
                .collect();
            serde_json::json!({
                "scope": "local",
                "source": "open-design",
                "sinceMs": report.since_ms,
                "since": cmduse_core::dates::iso_instant((report.since_ms.max(0) / 1000) as u64),
                "models": map,
            })
            .to_string()
        }
        Fmt::Csv => {
            let mut out = String::from("model,requests,tokens_in,tokens_out,credits,cost_usd\n");
            for m in models {
                out.push_str(&format!(
                    "{},{},{},{},{:.2},{:.2}\n",
                    crate::report_render::csv_field(&m.id),
                    m.month.requests,
                    m.month.input,
                    m.month.output,
                    m.month.credits,
                    m.month.cost,
                ));
            }
            out
        }
        Fmt::Table => String::new(), // the caller renders the table / detail
    }
}

/// One model in detail (`oduse model <id>`).
pub fn model_text(report: &Report, id: &str, colour: bool) -> String {
    let ink = Ink::new(colour);
    let Some(model) = report.models.iter().find(|m| m.id == id) else {
        return format!("{id}: no usage in the period\n");
    };
    let row =
        |label: &str, value: String| format!("  {}{value}\n", ink.dim_on(format!("{label:<12}")));
    let mut out = format!(
        "{} {}\n",
        ink.bold_on(model.id.clone()),
        ink.dim_on(format!("(x{} multiplier)", model.multiplier)),
    );
    out.push_str(&row(
        "credits",
        ink.cyan_on(if model.priced {
            money(model.month.credits)
        } else {
            "— (no rate for this model)".into()
        }),
    ));
    out.push_str(&row("list price", ink.cyan_on(money(model.month.cost))));
    out.push_str(&row(
        "turns",
        ink.cyan_on(format!("{} requests", model.month.requests)),
    ));
    out.push_str(&row("5-hour", ink.cyan_on(money(model.five_hour.credits))));
    out.push_str(&row("weekly", ink.cyan_on(money(model.weekly.credits))));
    if report.month.credits > 0.0 && model.priced {
        out.push_str(&row(
            "share",
            ink.dim_on(format!(
                "{:.1}% of period credits",
                model.month.credits / report.month.credits * 100.0
            )),
        ));
    }
    out
}
