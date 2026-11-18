// The meter-source contract: statusline must name which meter produced its
// window figures, and those figures must be the ones the frame prints.
use super::fixture::{plan, report, row, NOW_MS};
use crate::oduse::render;

// The account's own windows: 5h 4149/50000 credits left, 7d 29491/150000. At
// $0.0001 a credit that is $4.5851 used of $5.00 and $12.0509 used of $15.00.
const SNAP: &str = r#"{"designPlanWindows":[
  {"kind":"5h","windowStart":"2026-11-17T09:21:22.000Z","resetsAt":"2026-11-17T14:21:22.000Z",
   "remainingCredits":"4149","limitCredits":"50000"},
  {"kind":"7d","windowStart":"2026-11-16T13:21:22.000Z","resetsAt":"2026-11-23T13:21:22.000Z",
   "remainingCredits":"29491","limitCredits":"150000"}]}"#;

fn parsed(body: &str) -> serde_json::Value {
    serde_json::from_str(body).expect("valid json")
}

#[test]
fn statusline_names_the_meter_and_prints_its_figures() {
    let mut r = report(&[row(NOW_MS - 60_000, "deepseek-v4.1-flash", 30_892, 147)]);
    let go = plan("go");
    let local = parsed(&render::statusline_json(&r, &go));
    assert_eq!(local["meterSource"], "local");
    assert_eq!(local["snapshotError"], serde_json::Value::Null);
    let local_five = local["fiveHourSpent"].as_f64().unwrap();
    let local_week = local["weeklySpent"].as_f64().unwrap();
    assert!(
        local_five > 0.0 && local_week > 0.0,
        "fixture has local spend"
    );

    r.snapshot = Some(crate::oduse::snapshot::parse(SNAP).expect("snapshot parses"));
    let snap = parsed(&render::statusline_json(&r, &go));
    assert_eq!(snap["meterSource"], "snapshot");
    assert_eq!(snap["snapshotError"], serde_json::Value::Null);
    // The numbers match the frame's snapshot rows, not the local estimate.
    assert!((snap["fiveHourSpent"].as_f64().unwrap() - 4.5851).abs() < 1e-9);
    assert_eq!(snap["fiveHourCap"], 5.0);
    assert!((snap["weeklySpent"].as_f64().unwrap() - 12.0509).abs() < 1e-9);
    assert_eq!(snap["weeklyCap"], 15.0);
    assert!(
        (local_five - 4.5851).abs() > 1e-9,
        "the local figure must differ from the snapshot's"
    );
    assert!(
        (local_week - 12.0509).abs() > 1e-9,
        "the local figure must differ from the snapshot's"
    );
    assert_eq!(snap["fiveHourUsed"], snap["fiveHourSpent"]);
    assert_eq!(snap["weeklyUsed"], snap["weeklySpent"]);
    // `source` still names the store, never the meter.
    assert_eq!(snap["source"], "open-design");
}

#[test]
fn snapshot_error_is_the_same_key_on_both_surfaces() {
    let mut r = report(&[]);
    let go = plan("go");
    r.snapshot_error = Some("HTTP 401 Unauthorized".into());
    let status = parsed(&render::statusline_json(&r, &go));
    let dash = parsed(&render::render_json(&r, &go));
    assert_eq!(status["snapshotError"], "HTTP 401 Unauthorized");
    assert_eq!(dash["snapshotError"], status["snapshotError"]);
    assert_eq!(status["meterSource"], "local");
    assert_eq!(dash["meterSource"], status["meterSource"]);
    // No snapshot answer: the local figure stays, with the reason beside it.
    assert_eq!(status["fiveHourSpent"], r.five_hour.credits);
}
