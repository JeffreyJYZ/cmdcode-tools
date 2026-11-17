// `oduse -1 --json`: the machine projection of one report.
//
// Same key names as the other three binaries where the concept is the same
// (`source`, the period bounds, `summary`, `totals`), plus this one's own two:
// `credits` is the plan's unit and `wallet` is the daemon's balance — a balance,
// not a window, which is why it is a separate object rather than a `meter`.
use crate::oduse::od::Plan;
use crate::oduse::window::{ModelUsage, Report, Totals};

use super::report::totals_json;

fn totals(t: &Totals) -> serde_json::Value {
    totals_json(t.cost, t.credits, t.requests, t.input, t.output)
}

fn model(m: &ModelUsage) -> serde_json::Value {
    serde_json::json!({
        "id": m.id,
        "multiplier": m.multiplier,
        "priced": m.priced,
        "month": totals(&m.month),
        "fiveHour": totals(&m.five_hour),
        "weekly": totals(&m.weekly),
    })
}

pub fn render_json(report: &Report, plan: &Plan) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "source": "open-design",
        "generatedAt": report.now_ms,
        "plan": plan.id,
        "caps": {
            "monthlyUsd": plan.monthly_usd,
            "weeklyUsd": plan.weekly_usd,
            // null, never 0: the plan publishes no such cap.
            "fiveHourUsd": plan.five_hour_usd,
            "planModelCreditsUsd": plan.plan_model_credits_usd,
        },
        "periodStart": report.since_ms,
        "periodStartAt": report.since_ms,
        "periodEndAt": report.period_end_ms,
        "periodEnd": report
            .period_end_ms
            .map(|ms| super::date_of(ms.div_euclid(86_400_000))),
        "periodInferred": report.month_inferred,
        // Which stores the rows came from (`app`, `opencode`) — the same idea as
        // ocuse's `clients`, so a consumer never has to guess which store grew.
        "sources": report.sources,
        "notes": report.notes,
        "summary": totals(&report.month),
        "totals": {
            "month": totals(&report.month),
            "fiveHour": totals(&report.five_hour),
            "weekly": totals(&report.weekly),
        },
        // null when the desktop app is closed, or with --no-wallet; the reason
        // rides in `walletError` so a consumer can tell "no daemon" from "zero".
        "wallet": report.wallet.as_ref().map(|w| serde_json::json!({
            "balanceUsd": w.balance_usd,
            "source": w.source,
            "profile": w.profile,
            "user": w.user,
            "stale": w.stale,
        })),
        "walletError": report.wallet_error,
        "models": report.models.iter().map(model).collect::<Vec<_>>(),
    }))
    .expect("json")
}
