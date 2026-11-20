// `oduse -1 --json`: the machine projection of one report.
//
// Same key names as the other three binaries where the concept is the same
// (`source`, the period bounds, `summary`, `totals`), plus this one's own two:
// `credits` is the plan's unit and `wallet` is the account's or the daemon's
// balance — a balance, not a window, which is why it is a separate object rather
// than a `meter`. `walletSource` names the route that supplied it.
use crate::oduse::od::Plan;
use crate::oduse::window::{ModelUsage, Report, Span, Totals};

use super::report::totals_json;

/// The resolved window meter: the figures the human frame prints and the source
/// that produced them. `statusline --json` and this dashboard JSON both read it,
/// so a machine consumer and the frame cannot disagree on which number wins.
pub struct WindowMeter {
    pub five_hour_spent: f64,
    pub five_hour_cap: Option<f64>,
    pub weekly_spent: f64,
    pub weekly_cap: Option<f64>,
    pub source: crate::oduse::snapshot::Source,
}

/// A snapshot window wins per window, the same rule `dash.rs` applies; without
/// one, the local store's rolling cuts remain. `source` names whether a snapshot
/// answered at all, which is what `meterSource` has always meant.
pub fn window_meter(report: &Report, plan: &Plan) -> WindowMeter {
    let five_cap = crate::oduse::window::window_caps(&report.models, plan, Span::FiveHour);
    let week_cap = crate::oduse::window::window_caps(&report.models, plan, Span::Weekly);
    let five = report.snapshot.as_ref().and_then(|s| s.five_hour());
    let week = report.snapshot.as_ref().and_then(|s| s.weekly());
    WindowMeter {
        five_hour_spent: five
            .map(|w| w.used_usd())
            .unwrap_or(report.five_hour.credits),
        five_hour_cap: five
            .map(|w| w.limit_usd())
            .or(five_cap.chosen.five_hour_usd),
        weekly_spent: week.map(|w| w.used_usd()).unwrap_or(report.weekly.credits),
        weekly_cap: week.map(|w| w.limit_usd()).or(week_cap.chosen.weekly_usd),
        source: if report.snapshot.is_some() {
            crate::oduse::snapshot::Source::Snapshot
        } else {
            crate::oduse::snapshot::Source::Local
        },
    }
}

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

/// The account's own meters, beside the local totals. Every existing key stays;
/// `meterSource` says which one the dashboard printed, and the raw credit counts
/// sit next to the dollars so no conversion is hidden from a consumer.
fn snapshot_json(report: &Report) -> serde_json::Value {
    match &report.snapshot {
        None => serde_json::Value::Null,
        Some(s) => serde_json::json!({
            "creditToUsd": crate::oduse::snapshot::CREDIT_TO_USD,
            "plan": s.plan_tier,
            "periodStart": s.period_start,
            "periodEnd": s.period_end,
            "balanceUsd": s.balance_usd,
            "windows": s.windows.iter().map(|w| serde_json::json!({
                "kind": w.kind,
                "label": w.label(),
                "remainingCredits": w.remaining_credits,
                "limitCredits": w.limit_credits,
                "remainingUsd": w.remaining_usd(),
                "usedUsd": w.used_usd(),
                "limitUsd": w.limit_usd(),
                "leftPct": w.left_pct(),
                "windowStart": w.window_start,
                "resetsAt": w.resets_at,
            })).collect::<Vec<_>>(),
        }),
    }
}

pub fn render_json(report: &Report, plan: &Plan) -> String {
    // Each window is capped by the set its own models draw on: a report mixing
    // DeepSeek V4.1 Flash with the Eco variant is capped by the Flash set, so the
    // number a consumer divides by is reported here rather than guessed.
    let five = crate::oduse::window::window_caps(
        &report.models,
        plan,
        crate::oduse::window::Span::FiveHour,
    );
    let week =
        crate::oduse::window::window_caps(&report.models, plan, crate::oduse::window::Span::Weekly);
    let month =
        crate::oduse::window::window_caps(&report.models, plan, crate::oduse::window::Span::Month);
    let pick = |p: &crate::oduse::od::CapPick, span: Span| {
        // The sidebar reads this key **per window** as the plan's looser figure
        // for that window, so it must carry $220 on the month, $55 on the week and
        // $18 on the 5-hour — not the monthly figure on all three. The key keeps
        // its shipped name so a consumer written to it needs no change.
        let looser = p.looser.as_ref().and_then(|l| match span {
            Span::FiveHour => l.five_hour_usd,
            Span::Weekly => l.weekly_usd,
            Span::Month => Some(l.monthly_usd),
        });
        serde_json::json!({
            "id": p.chosen.id,
            "label": p.chosen.label,
            "planDefaultMonthlyUsd": looser,
        })
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "source": "open-design",
        "generatedAt": report.now_ms,
        // Which price table priced every figure below (live / cache / builtin).
        "catalog": super::catalog_json(),
        "plan": plan.id,
        "caps": {
            // The plan's published set; `capPicks` says which one each window used.
            "monthlyUsd": plan.monthly_usd,
            "weeklyUsd": plan.weekly_usd,
            // null, never 0: the plan publishes no such cap.
            "fiveHourUsd": plan.five_hour_usd,
            "planModelCreditsUsd": plan.plan_model_credits_usd,
            "defaultCapLabel": plan.default_cap_label,
            "capOverrides": plan.cap_overrides.iter().map(|set| serde_json::json!({
                "id": set.id,
                "label": set.label,
                "models": set.models,
                "monthlyUsd": set.monthly_usd,
                "weeklyUsd": set.weekly_usd,
                "fiveHourUsd": set.five_hour_usd,
            })).collect::<Vec<_>>(),
        },
        "capPicks": {
            "monthly": pick(&month, Span::Month),
            "weekly": pick(&week, Span::Weekly),
            "fiveHour": pick(&five, Span::FiveHour),
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
            // API only: when this balance snapshot expires / was refreshed.
            "expiresAt": w.expires_at,
            "updatedAt": w.updated_at,
        })),
        // Which route produced the number: `api` or `daemon`, null when absent.
        "walletSource": report.wallet_source.map(|s| s.as_str()),
        "walletError": report.wallet_error,
        // Which source produced the window figures the dashboard prints. The
        // totals above stay the local-store rows; the authoritative numbers are
        // in `snapshot`, and are the ones the human-facing frame shows.
        "meterSource": window_meter(report, plan).source.as_str(),
        "snapshot": snapshot_json(report),
        "snapshotError": report.snapshot_error,
        "models": report.models.iter().map(model).collect::<Vec<_>>(),
    }))
    .expect("json")
}
