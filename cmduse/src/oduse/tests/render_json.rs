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
            Fmt::Json
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
            Fmt::Json
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
    });
    let parsed: serde_json::Value =
        serde_json::from_str(&render::render_json(&with_wallet, &plan("go"))).unwrap();
    assert_eq!(parsed["source"], "open-design");
    assert_eq!(parsed["plan"], "go");
    assert_eq!(parsed["summary"], parsed["totals"]["month"]);
    assert_eq!(parsed["wallet"]["balanceUsd"], 3.25);
    assert_eq!(parsed["caps"]["monthlyUsd"], 220.0);
    assert_eq!(parsed["caps"]["fiveHourUsd"], 18.0);
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
    assert_eq!(json["fiveHourCap"], 18.0);
    assert_eq!(json["monthCap"], 220.0);
    assert_eq!(json["walletUsd"], serde_json::Value::Null);
}

#[test]
fn the_catalogues_state_their_provenance() {
    let text = render::plans_text(false);
    assert!(text.contains("PLAN"), "{text}");
    // The rate table carries the store's own model ids — those are what a turn
    // reports, so they are what a reader has to match against.
    assert!(text.contains("deepseek-v4.1-flash"), "{text}");
    assert!(
        text.contains("estimate"),
        "the estimated row is marked: {text}"
    );
    assert!(text.contains("credit"), "{text}");
    // Pro's published credit allowance is in the table.
    assert!(text.contains("$120.00"), "{text}");
    // The plan price carries the same currency symbol as the caps beside it.
    assert!(text.contains("$10/mo"), "{text}");
    let json: serde_json::Value = serde_json::from_str(&render::plans_json()).unwrap();
    assert_eq!(json["plans"][0]["id"], "go");
    assert_eq!(json["creditUnit"], crate::oduse::od::catalog().credit_unit);
    let models: Vec<serde_json::Value> = render::models_json("go")
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert!(models.iter().any(|m| m["id"] == "glm-5.3-flash"));
    assert!(models.iter().all(|m| m["plan"] == "go"));
    assert!(models.iter().all(|m| m["fiveHourCapUsd"].is_number()));
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
