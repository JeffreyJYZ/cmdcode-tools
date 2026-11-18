// The catalogues: `plans` and `models` in both forms, and the two machine-readable
// spellings that drifted from the rest of the family.
use crate::oduse::render;

#[test]
fn the_catalogues_state_their_provenance() {
    let text = render::plans_text(false);
    assert!(text.contains("PLAN"), "{text}");
    // The rate table carries the store's own model ids — those are what a turn
    // reports, so they are what a reader has to match against.
    assert!(text.contains("deepseek-v4.1-flash"), "{text}");
    // Every rate row now comes from Open Design's published list. Check the
    // rows themselves, not the notes: a note may legitimately mention an
    // estimate to explain that none remain.
    let rates = render::models_text("go", false);
    let rate_rows: Vec<&str> = rates
        .lines()
        .filter(|l| l.contains('$') && !l.contains("credits ="))
        .collect();
    assert_eq!(rate_rows.len(), 46, "one row per model: {rates}");
    assert!(
        rate_rows.iter().all(|l| l.contains("published")),
        "every rate row is marked published: {rate_rows:?}"
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
    assert!(
        models.iter().all(|m| m["rateSource"] == "published"),
        "the JSON keeps the same provenance word as the table"
    );
    assert!(models.iter().all(|m| m["fiveHourCapUsd"].is_number()));
    // The model row spells its display name `name`, like the other three
    // binaries; `plans[]` keeps `label`, so one concept has one key per surface.
    assert!(models.iter().all(|m| m["name"].is_string()));
    assert!(models.iter().all(|m| m.get("label").is_none()));
    // `plans --json` carries the same window-share divisor map ocuse and arkuse
    // publish, so a consumer reading `windows` gets an answer on all four. The
    // share is rounded to four decimals, so it pins the published caps without a
    // float's tail: $18/$220 and $55/$220.
    let windows = &json["windows"];
    assert_eq!(windows["monthly"], 1.0);
    assert_eq!(windows["fiveHour"], 0.0818);
    assert_eq!(windows["weekly"], 0.25);
}

#[test]
fn a_published_rate_renders_as_published() {
    let text = render::models_text("go", false);
    let row = text
        .lines()
        .find(|l| l.trim_start().starts_with("deepseek-v4.1-flash"))
        .expect("the Flash rate row");
    // The old `rateSource == "repo"` check printed `estimate` for every row,
    // because the vocabulary moved to `published`. Pin the exact label here.
    assert!(row.contains("published"), "{row}");
    assert!(!row.contains("estimate"), "{row}");
    assert!(text.contains("RATE"), "{text}");
}
