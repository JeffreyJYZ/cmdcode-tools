// The machine surfaces: the shared report envelopes, the `-1 --json` shape, the
// statusline, and the catalogues.
use super::fixture::{live_report, plan, report, row, NOW_MS};
use crate::oduse::render::{self, DEFAULT_BAR_WIDTH};
use crate::oduse::wallet::Wallet;
use crate::report_render::Fmt;

#[test]
fn report_json_envelopes_are_the_shared_contract() {
    use crate::report_render::{
        REPORT_DAILY_KEYS, REPORT_HOURLY_KEYS, REPORT_MODEL_KEYS, REPORT_SESSION_KEYS,
    };
    let keys = |body: String| -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        v.as_object().unwrap().keys().cloned().collect()
    };
    let day = 86_400_000;
    let catalog = super::fixture::catalog();
    assert_eq!(
        keys(render::bucket_text(
            &[],
            &catalog,
            NOW_MS,
            2 * day,
            day,
            0,
            false,
            Fmt::Json,
            usize::MAX
        )),
        REPORT_DAILY_KEYS.to_vec()
    );
    assert_eq!(
        keys(render::bucket_text(
            &[],
            &catalog,
            NOW_MS,
            2 * 3_600_000,
            3_600_000,
            0,
            false,
            Fmt::Json,
            usize::MAX
        )),
        REPORT_HOURLY_KEYS.to_vec()
    );
    assert_eq!(
        keys(render::model_report(&report(&[]), None, Fmt::Json)),
        REPORT_MODEL_KEYS.to_vec()
    );
    assert_eq!(
        keys(render::session_text(&[], &catalog, 5, false, Fmt::Json)),
        REPORT_SESSION_KEYS.to_vec()
    );
}

#[test]
fn the_json_surface_is_the_family_shape() {
    let mut with_wallet = live_report();
    with_wallet.period_end_ms = Some(crate::oduse::window::next_month(with_wallet.since_ms));
    with_wallet.wallet = Some(Wallet {
        balance_usd: 3.25,
        source: Some("vela".into()),
        profile: None,
        user: None,
        stale: false,
        ..Default::default()
    });
    with_wallet.wallet_source = Some(crate::oduse::meter::Source::Daemon);
    let parsed: serde_json::Value =
        serde_json::from_str(&render::render_json(&with_wallet, &plan("go"))).unwrap();
    assert_eq!(parsed["source"], "open-design");
    assert_eq!(parsed["walletSource"], "daemon");
    assert_eq!(parsed["wallet"]["expiresAt"], serde_json::Value::Null);
    assert_eq!(parsed["plan"], "go");
    assert_eq!(parsed["summary"], parsed["totals"]["month"]);
    assert_eq!(parsed["wallet"]["balanceUsd"], 3.25);
    // The API route carries both wire timestamps through and names itself.
    let mut api = live_report();
    api.wallet = Some(Wallet {
        balance_usd: 1.0,
        expires_at: Some("2026-12-16T13:21:22.000Z".into()),
        updated_at: Some("2026-11-16T13:21:30.404Z".into()),
        ..Default::default()
    });
    api.wallet_source = Some(crate::oduse::meter::Source::Api);
    let parsed: serde_json::Value =
        serde_json::from_str(&render::render_json(&api, &plan("go"))).unwrap();
    assert_eq!(parsed["walletSource"], "api");
    assert_eq!(parsed["wallet"]["balanceUsd"], 1.0);
    assert_eq!(parsed["wallet"]["expiresAt"], "2026-12-16T13:21:22.000Z");
    assert_eq!(parsed["wallet"]["updatedAt"], "2026-11-16T13:21:30.404Z");
    // `caps` is the plan's own published set; the per-window picks follow it.
    assert_eq!(parsed["caps"]["monthlyUsd"], 220.0);
    assert_eq!(parsed["caps"]["fiveHourUsd"], 18.0);
    assert_eq!(parsed["caps"]["defaultCapLabel"], "Eco");
    assert_eq!(parsed["caps"]["capOverrides"][0]["id"], "flash");
    // The fixture spends on DeepSeek V4.1 Flash, so every window is capped by the
    // Flash set and says what the Eco set would have allowed.
    assert_eq!(parsed["capPicks"]["monthly"]["id"], "flash");
    assert_eq!(parsed["capPicks"]["fiveHour"]["id"], "flash");
    // The sidebar reads `planDefaultMonthlyUsd` as the looser figure for *each*
    // window, so it must carry that window's cap: $220 month, $55 week, $18 5h.
    // Emitting the monthly figure on all three made the panel name `Eco $220`
    // as the 5-hour and weekly alternatives when the real ones are $18 and $55.
    assert_eq!(
        parsed["capPicks"]["monthly"]["planDefaultMonthlyUsd"],
        220.0
    );
    assert_eq!(parsed["capPicks"]["weekly"]["planDefaultMonthlyUsd"], 55.0);
    assert_eq!(
        parsed["capPicks"]["fiveHour"]["planDefaultMonthlyUsd"],
        18.0
    );
    assert_eq!(parsed["models"][0]["id"], "deepseek-v4.1-flash");
    assert_eq!(
        parsed["periodEnd"],
        crate::oduse::render::date_of(with_wallet.period_end_ms.unwrap() / 86_400_000)
    );
    assert_eq!(parsed["periodStartAt"], with_wallet.since_ms);

    // No daemon: the key is present and null, and the reason rides beside it.
    let mut silent = live_report();
    silent.wallet_error = Some("daemon not running".into());
    let parsed: serde_json::Value =
        serde_json::from_str(&render::render_json(&silent, &plan("go"))).unwrap();
    assert_eq!(parsed["wallet"], serde_json::Value::Null);
    assert_eq!(parsed["walletSource"], serde_json::Value::Null);
    assert_eq!(parsed["walletError"], "daemon not running");
    // A plan without a 5-hour cap reports null, never zero.
    let parsed: serde_json::Value =
        serde_json::from_str(&render::render_json(&silent, &plan("pro"))).unwrap();
    assert_eq!(parsed["caps"]["fiveHourUsd"], serde_json::Value::Null);
}

#[test]
fn statusline_resolves_every_placeholder() {
    let report = live_report();
    let go = plan("go");
    let line = |tpl: &str| render::statusline_template(&report, &go, tpl, false, false, 20);
    assert_eq!(line("{plan}"), "go");
    assert_eq!(line("{period}"), "calendar month");
    assert!(
        line("{month_pct}").ends_with('%'),
        "{}",
        line("{month_pct}")
    );
    // No wallet: the placeholder degrades to a dash, not to $0.00.
    assert_eq!(line("{wallet}"), "—");
    assert_eq!(line("{models}"), "deepseek-v4.1-flash");
    assert_eq!(line("{bogus} tail"), " tail");
    let pro = plan("pro");
    assert_eq!(
        render::statusline_template(&report, &pro, "{five_hour_pct}", false, false, 20),
        "—",
        "no 5-hour cap to divide by"
    );
    let json: serde_json::Value =
        serde_json::from_str(&render::statusline_json(&report, &go)).unwrap();
    // The fixture's one turn is DeepSeek V4.1 Flash, whose Go caps are the Flash
    // set ($120/mo, $10/5h) — not the plan's headline Eco set.
    assert_eq!(json["fiveHourCap"], 10.0);
    assert_eq!(json["monthCap"], 120.0);
    assert_eq!(json["capLabel"], "Flash");
    assert_eq!(json["walletUsd"], serde_json::Value::Null);
    assert_eq!(json["walletSource"], serde_json::Value::Null);
}

#[test]
fn the_model_detail_and_tables_carry_the_credits() {
    let report = live_report();
    let detail = render::model_text(&report, "deepseek-v4.1-flash", false);
    assert!(detail.contains("x0.5"), "{detail}");
    assert!(detail.contains("100.0% of period credits"), "{detail}");
    assert!(!render::model_text(&report, "nope", false).contains("share"));
    let csv = render::model_report(&report, None, Fmt::Csv);
    assert!(
        csv.starts_with("model,requests,tokens_in,tokens_out,credits,cost_usd\n"),
        "{csv}"
    );
    let rows = vec![row(NOW_MS - 60_000, "glm-5.3-flash", 10, 20)];
    let csv = render::session_text(&rows, &super::fixture::catalog(), 20, false, Fmt::Csv);
    assert!(
        csv.starts_with("session,requests,tokens_in,tokens_out,credits,cost_usd\n"),
        "{csv}"
    );
    // The session table names the project, not the opaque conversation id.
    let table = render::session_text(&rows, &super::fixture::catalog(), 20, false, Fmt::Table);
    assert!(table.contains("Greeting and Next Steps"), "{table}");
}

#[test]
fn watch_frames_end_on_the_callers_status_line() {
    let frame = render::watch_frame(
        &live_report(),
        &plan("go"),
        "/tmp/a.db",
        10,
        true,
        &[0.0, 1.5],
        10,
        DEFAULT_BAR_WIDTH,
    );
    assert!(!frame.ends_with('\n'), "the caller owns the last row");
    assert!(frame.contains("spend bursts (10s samples)"), "{frame}");
    let compact = render::compact_line(&live_report(), &plan("go"), &[], true);
    assert_eq!(compact.lines().count(), 1, "{compact}");
    assert!(compact.contains("month"), "{compact}");
}
