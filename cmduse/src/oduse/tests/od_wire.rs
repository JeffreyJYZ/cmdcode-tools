// The catalogue keyed by the gateway's wire id: the ids `GET /v1/models`
// returns, and therefore the ids a recorded turn carries.
//
// Split from `od.rs` so each file stays under the repo's line cap and the two
// questions stay apart: `od.rs` asks whether a rate is what it claims to be, this
// asks whether a turn that happened can find its row at all.
use crate::oduse::od;

/// The gateway's live model list, as `GET /v1/models` returns it (captured
/// 2026-11-16). A recorded turn names one of these, so each has to key a row —
/// an id the table does not carry is metered at zero.
const LIVE_IDS: [&str; 14] = [
    "claude-haiku-5.5",
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "deepseek-v4-pro",
    "deepseek-v4.1-flash",
    "deepseek-v4.1-flash-eco",
    "glm-5.3-flash",
    "glm-5.3-flashx",
    "gpt-6-luna",
    "hy4-preview",
    "kimi-k2.7-code",
    "mimo-v2.6-flash",
    "mimo-v2.6-pro",
    "minimax-m3.1-flash",
];

#[test]
fn every_wire_id_the_gateway_serves_keys_a_row() {
    let c = od::catalog();
    for id in LIVE_IDS {
        let model = c
            .model(id)
            .unwrap_or_else(|| panic!("{id} is served but keys no row"));
        assert!(
            c.price(id, 1_000_000, 0).is_some(),
            "{id} must price a turn"
        );
        assert!(!model.label.is_empty(), "{id} keeps its human label");
    }
    // The row set and the live list agree: nothing is carried that the gateway
    // cannot serve, so no row is dead weight.
    for model in &c.models {
        assert!(
            LIVE_IDS.contains(&model.id.as_str()),
            "{} is in od.json but the gateway does not serve it",
            model.id
        );
    }
}

#[test]
fn a_turn_on_a_served_id_prices_and_one_off_the_list_stays_unpriced() {
    use super::fixture::{row, NOW_MS};
    let since = crate::oduse::window::calendar_month_start(NOW_MS);
    // Three wire ids the audit found missing, including the two whose catalogue
    // spelling differs — each must now be metered.
    let rows = vec![
        row(NOW_MS - 60_000, "claude-haiku-5.5", 1_000_000, 0),
        row(NOW_MS - 60_000, "glm-5.3-flashx", 1_000_000, 0),
        row(
            NOW_MS - 60_000,
            "deepseek-v4.1-flash-eco",
            1_000_000,
            1_000_000,
        ),
    ];
    let report =
        crate::oduse::window::build(&rows, &od::catalog(), od::DEFAULT_PLAN, NOW_MS, Some(since));
    assert_eq!(report.month.unpriced, 0, "{:?}", report.month);
    assert!(report.month.credits > 0.0, "{:?}", report.month);
    let by_id = |id: &str| report.models.iter().find(|m| m.id == id).expect(id);
    // Haiku at x2 on $0.10 = $0.20 credits for 1M input. The multiplier stays
    // whatever the table says — its 2x-vs-4x conflict is an open decision.
    assert!((by_id("claude-haiku-5.5").month.credits - 0.2).abs() < 1e-9);
    // An id the list does not carry is counted as unpriced, never silently $0.
    let unknown = vec![row(NOW_MS - 60_000, "retired-model-9", 5_000, 100)];
    let report = crate::oduse::window::build(
        &unknown,
        &od::catalog(),
        od::DEFAULT_PLAN,
        NOW_MS,
        Some(since),
    );
    assert_eq!(report.month.unpriced, 1, "{:?}", report.month);
    assert_eq!(report.month.credits, 0.0);
}
