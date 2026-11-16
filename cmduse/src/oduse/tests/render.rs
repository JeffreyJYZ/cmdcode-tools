// Presentation: the colour contract and the wording the dashboard must not lose
// (estimate, absent cap, wallet reason).
use super::fixture::{live_report, plan, row, NOW_MS};
use crate::oduse::render::{self, DEFAULT_BAR_WIDTH};
use crate::oduse::wallet::Wallet;
use crate::report_render::Fmt;

#[test]
fn the_dashboard_carries_the_turn_it_was_given() {
    let text = render::render_text(
        &live_report(),
        &plan("go"),
        "/tmp/app.sqlite",
        10,
        false,
        DEFAULT_BAR_WIDTH,
    );
    assert!(text.contains("deepseek-v4.1-flash"), "{text}");
    assert!(text.contains("credits"), "{text}");
    // 30,892 in + 147 out: $0.0047 list, x0.5 = $0.0024 credits — under a cent,
    // so the fixture's own turn rounds to $0.00.
    assert!(text.contains("$0.00"), "cents round the tiny turn: {text}");
    assert!(
        text.contains("no cache tokens"),
        "the estimate's reason: {text}"
    );
    assert!(text.contains("/tmp/app.sqlite"), "{text}");
}

/// A plan without a 5-hour cap prints no 5-hour row: absent, never zero.
#[test]
fn a_cap_the_plan_does_not_publish_is_absent() {
    let go = render::render_text(&live_report(), &plan("go"), "/tmp/a.db", 10, false, 20);
    assert!(go.contains("5-hour"), "{go}");
    let pro = render::render_text(&live_report(), &plan("pro"), "/tmp/a.db", 10, false, 20);
    assert!(!pro.contains("5-hour"), "{pro}");
    // Pro's plan-model credits are published, with no local meter.
    assert!(pro.contains("plan-model credits $120.00"), "{pro}");
}

#[test]
fn the_wallet_prints_when_it_answered_and_explains_itself_when_it_did_not() {
    let mut answered = live_report();
    answered.wallet = Some(Wallet {
        balance_usd: 12.5,
        source: Some("vela".into()),
        profile: Some("pro".into()),
        user: Some("jyz".into()),
        stale: true,
    });
    let text = render::render_text(&answered, &plan("go"), "/tmp/a.db", 10, false, 20);
    assert!(
        text.contains("wallet: $12.50 · pro · jyz · cached"),
        "{text}"
    );

    let mut silent = live_report();
    silent.wallet_error = Some("daemon not running at http://127.0.0.1:7456".into());
    let text = render::render_text(&silent, &plan("go"), "/tmp/a.db", 10, false, 20);
    assert!(text.contains("wallet: daemon not running"), "{text}");
    // A named reason is not a failure: the dashboard still rendered.
    assert!(text.contains("period:"), "{text}");
}

#[test]
fn every_renderer_respects_the_colour_flag() {
    let report = live_report();
    let ink_cases: Vec<(&str, String, String)> = vec![
        (
            "render_text",
            render::render_text(&report, &plan("go"), "/tmp/a.db", 10, false, 20),
            render::render_text(&report, &plan("go"), "/tmp/a.db", 10, true, 20),
        ),
        (
            "statusline_template",
            render::statusline_template(&report, &plan("go"), "{period} {month}", false, false, 20),
            render::statusline_template(&report, &plan("go"), "{period} {month}", true, false, 20),
        ),
        (
            "compact_line",
            render::compact_line(&report, &plan("go"), &[], false),
            render::compact_line(&report, &plan("go"), &[], true),
        ),
        (
            "plans_text",
            render::plans_text(false),
            render::plans_text(true),
        ),
        (
            "models_text",
            render::models_text("go", false),
            render::models_text("go", true),
        ),
        (
            "model_text",
            render::model_text(&report, "deepseek-v4.1-flash", false),
            render::model_text(&report, "deepseek-v4.1-flash", true),
        ),
    ];
    for (name, plain, coloured) in ink_cases {
        assert!(
            !plain.contains('\x1b'),
            "{name} leaked escapes when off: {plain}"
        );
        assert!(
            coloured.contains('\x1b'),
            "{name} rendered nothing coloured when on: {coloured}"
        );
    }
    // Machine formats ignore the colour flag entirely.
    let rows = vec![row(NOW_MS - 60_000, "glm-5.3-flash", 10, 20)];
    for fmt in [Fmt::Json, Fmt::Csv] {
        for colour in [false, true] {
            let out = render::bucket_text(
                &rows,
                &super::fixture::catalog(),
                NOW_MS,
                7 * 86_400_000,
                86_400_000,
                0,
                colour,
                fmt,
            );
            assert!(!out.contains('\x1b'), "{fmt:?} must never be coloured");
        }
    }
}
