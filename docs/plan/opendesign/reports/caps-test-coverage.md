# Test-coverage audit — oduse per-model caps and elapsed clock

Read-only audit of `cmduse/src/oduse/tests/**` against
`docs/plan/opendesign/briefs/oduse-per-model-caps.md`. No test file was modified;
no gate was run against the dirty tree. The concurrent lane owns `oduse/**` and
`core/od.json`. Findings below are gaps where the brief demands a behaviour and
no test would fail if that behaviour were removed or regressed.

## 1. Brief behaviour -> proving test (already covered)

| Brief demand | Test that fails if removed |
| --- | --- |
| Go Eco resolves to 220/55/18 | `caps_data.rs::go_caps_are_per_model_class` |
| Go Flash resolves to 120/30/10 | same |
| Flash fallback for an override-free model | same (`glm-5.3-flash` -> eco) |
| Mixed window picks stricter set, keeps looser | `caps_data.rs::a_mixed_window_takes_the_stricter_set_and_keeps_the_other` |
| Idle model cannot make a window stricter | `caps_data.rs::only_the_models_that_spent_pick_the_cap` |
| Frame names the set it used | `caps.rs::a_mixed_window_names_the_cap_set_it_used` |
| Single-set plan prints no note | `caps.rs::a_single_set_plan_prints_no_cap_note` |
| Heading lists both sets | `caps.rs::the_heading_lists_the_other_sets` |
| Cap note survives colour | `caps.rs::the_cap_note_survives_both_colour_modes` |
| Pro one set, no Eco row | `caps_data.rs::pro_has_one_set_and_no_eco_row` |
| Pinned period -> arithmetic share | `elapsed.rs::a_pinned_period_yields_the_arithmetic_share` |
| `--window all` -> no percentage | `elapsed.rs::a_period_with_no_end_has_no_percentage` |
| Calendar month -> no anchor | `elapsed.rs::a_calendar_month_is_not_an_anchor` |
| Anniversary inference -> share | `elapsed.rs::the_anniversary_inference_yields_a_share_from_that_boundary` |
| Statusline divides by chosen set | `render_json.rs::statusline_resolves_every_placeholder` |

The brief's four explicitly named cap tests and three named elapsed tests are
present. The gaps are in the *machine-readable surfaces* and the *consumer
consequences*, which the brief also demands (item 3 in Defect 1).

## 2. Gaps, ranked by cost of a wrong answer

### GAP-1 — HIGH — `models --json` cap figures are never asserted

Brief item 3: `models --json` must expose the cap set per model so the sidebar
and mpc can read it. `render_catalog.rs::the_catalogues_state_their_provenance`
parses every `models --json` row but only checks `fiveHourCapUsd` is *a number*.
Nothing asserts Flash = 120/30/10 and Eco = 220/55/18. If `model_caps` were
changed to stamp `plan.monthly_usd` on every row (the exact bug being fixed),
all 60+ oduse tests stay green while the sidebar reads $220 for Flash — the
~1.8x headroom overstatement the brief is about.

### GAP-2 — HIGH — `plans --json` override figures unasserted; `-1 --json` omits the chosen cap figure

`render_json.rs:78` asserts `capOverrides[0].id == "flash"` and
`capPicks.monthly.id == "flash"`, never the override's *values*. A change that
kept the label "flash" but set `monthlyUsd: 220` passes. Worse, the `pick()`
closure in `render/json.rs:40-48` emits only `id`, `label`,
`planDefaultMonthlyUsd` — there is no chosen `monthlyUsd`/`weeklyUsd`/
`fiveHourUsd` field in `capPicks`. A consumer of `-1 --json` is therefore told
"flash" but handed only `caps.monthlyUsd = 220` as a divisor, so it recomputes
the old wrong percentage. The statusline JSON does carry `monthCap: 120`, which
is asserted — the report surface is the hole.

### GAP-3 — MEDIUM-HIGH — Plus's original Flash allowance is source-cited but absent from data and tests

Brief line 13 quotes `/help/billing`: original Flash is "$120/month on Go and
$160/month on Plus". `core/od.json` gives Plus a single $310 set with no
override, and `caps_data.rs::pro_has_one_set_and_no_eco_row` explicitly asserts
`plus.cap_overrides.is_empty()` — locking in the reading that contradicts the
brief's own source. No test pins 160. Cost: a Plus Flash user reading ~$310 of
headroom against a real $160 allowance. **Not settled by the brief's "Do" list**
(which names Pro/Max as single-set and is silent on Plus) — treat the proposed
test as *recommended, needs a ruling* before the owning lane adds the data.

### GAP-4 — MEDIUM — `over_window` notification never exercised with a mixed store

`window.rs::a_window_over_its_published_cap_says_which` uses `kimi-k2.7-code`
(no override, so the Eco set is chosen) and the exact-cap test injects credits
into an empty report. No test has a store whose models draw on *both* sets.
If `over_window` regressed to dividing by `plan.monthly_usd`/`five_hour_usd`
unconditionally, the watch loop would stay quiet until $18 of Flash spend
instead of $10 — a missed cap notification, and the one place the cap decision
is actionable while running.

### GAP-5 — MEDIUM-LOW — cap note's weekly and 5-hour looser figures unasserted

`caps.rs::a_mixed_window_names_the_cap_set_it_used` checks the Monthly note
("Eco would be $220.00") and the *used* figures on the 5-hour ($10) and Weekly
($30) rows, but never that those rows say "Eco would be $18.00" and "$55.00".
`cap_note()` is fed a window-specific `looser_cap`; a regression that passed
`l.monthly_usd` for every window prints "$220" on all three rows and passes.
Misleading label, but the divisor stays correct — lower cost than GAP-1/2.

### GAP-6 — LOW — `window — elapsed unknown` branch has no test

`render/windows.rs:91-93` emits this when an anchored period's `elapsed_pct`
returns `None`. `core::elapsed_pct` clamps after the period ends, so the branch
is only reachable for a period that has not started (`now_ms < start`) — a
contrived case. Cosmetic; list for completeness, not worth blocking a landing.

## 3. Proposed test bodies (paste targets)

None of these were written into the repo. Each is sized for the owning lane's
existing file, keeping files under the 200-line cap.

### For `cmduse/src/oduse/tests/render_catalog.rs` (GAP-1, GAP-2 plans half)

```rust
/// The per-model caps in `models --json` are what the sidebar and mpc read.
/// Stamping the plan's headline $220 on the Flash row overstates its headroom
/// by ~1.8x while every other oduse test stays green.
#[test]
fn models_json_reports_each_models_own_cap_set() {
    let rows = |plan_id: &str| -> Vec<serde_json::Value> {
        crate::oduse::render::models_json(plan_id)
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    };
    let go = rows("go");
    let get = |v: &[serde_json::Value], id: &str| -> &serde_json::Value {
        v.iter().find(|m| m["id"] == id).expect("model")
    };
    let flash = get(&go, "deepseek-v4.1-flash");
    assert_eq!(flash["capSet"], "flash");
    assert_eq!(flash["capLabel"], "Flash");
    assert_eq!(flash["monthCapUsd"], 120.0);
    assert_eq!(flash["weeklyCapUsd"], 30.0);
    assert_eq!(flash["fiveHourCapUsd"], 10.0);
    let eco = get(&go, "deepseek-v4.1-flash-eco");
    assert_eq!(eco["capSet"], "eco");
    assert_eq!(eco["monthCapUsd"], 220.0);
    assert_eq!(eco["weeklyCapUsd"], 55.0);
    assert_eq!(eco["fiveHourCapUsd"], 18.0);
    // No override: the model draws the plan's own set.
    assert_eq!(get(&go, "glm-5.3-flash")["monthCapUsd"], 220.0);
    // Pro publishes one set: one figure for every model.
    let pro = rows("pro");
    assert!(
        pro.iter().all(|m| m["monthCapUsd"] == 480.0),
        "one cap for every model on a single-set plan"
    );
}
```

```rust
/// `plans --json` carries the figures, not just the override's id — a consumer
/// that reads `capOverrides` must get 120/30/10 for Flash, not the $220 headline.
#[test]
fn plans_json_publishes_each_cap_set_figure() {
    let json: serde_json::Value =
        serde_json::from_str(&crate::oduse::render::plans_json()).unwrap();
    let plans = json["plans"].as_array().expect("plans");
    let go = plans.iter().find(|p| p["id"] == "go").expect("go");
    assert_eq!(go["defaultCapLabel"], "Eco");
    let flash = go["capOverrides"].as_array().expect("overrides")
        .iter().find(|s| s["id"] == "flash").expect("flash set");
    assert_eq!(flash["monthlyUsd"], 120.0);
    assert_eq!(flash["weeklyUsd"], 30.0);
    assert_eq!(flash["fiveHourUsd"], 10.0);
    assert_eq!(flash["models"][0], "deepseek-v4.1-flash");
    // Pro/Max publish one set: no overrides, no second label.
    for id in ["pro", "max"] {
        let p = plans.iter().find(|p| p["id"] == id).expect("plan");
        assert_eq!(p["capOverrides"].as_array().unwrap().len(), 0, "{id}");
        assert!(p["defaultCapLabel"].is_null(), "{id}");
    }
}
```

### For `cmduse/src/oduse/tests/render_json.rs` (GAP-2 `-1` half)

**Note:** this test cannot pass until `render/json.rs::pick()` also emits the
chosen cap figures. Paste it only with the field addition, or it fails to read
the keys. That addition is the point of GAP-2.

```rust
/// A `-1 --json` consumer computes a share from the cap the window actually
/// picked. Naming the set without its figure leaves only the $220 headline,
/// which is the wrong divisor for a Flash month.
#[test]
fn json_cap_picks_carry_the_chosen_cap_figure() {
    let parsed: serde_json::Value = serde_json::from_str(
        &crate::oduse::render::render_json(
            &super::fixture::live_report(),
            &super::fixture::plan("go"),
        ),
    )
    .unwrap();
    // The fixture spends on DeepSeek V4.1 Flash only, so Flash wins every pick.
    let picks = &parsed["capPicks"];
    assert_eq!(picks["monthly"]["id"], "flash");
    assert_eq!(picks["monthly"]["monthlyUsd"], 120.0);
    assert_eq!(picks["weekly"]["weeklyUsd"], 30.0);
    assert_eq!(picks["fiveHour"]["fiveHourUsd"], 10.0);
    assert_eq!(picks["monthly"]["planDefaultMonthlyUsd"], 220.0);
}
```

### For `cmduse/src/oduse/tests/caps_data.rs` (GAP-3 — needs a ruling first)

```rust
/// Quoted in the brief from /help/billing: the original Flash allowance stays
/// own-plan-specific — $120/month on Go, $160/month on Plus. This test conflicts
/// with the current `plus` row in core/od.json and with
/// `pro_has_one_set_and_no_eco_row`'s plus assertion; add the Plus override and
/// narrow that assertion in the same change, or drop this test if the ruling
/// is that only Go is in scope.
#[test]
fn plus_flash_keeps_its_own_allowance() {
    let plus = crate::oduse::od::catalog().plan("plus").expect("plus");
    let flash = plus.cap_set_for("deepseek-v4.1-flash");
    assert_eq!(flash.monthly_usd, 160.0, "published in /help/billing");
}
```

### For `cmduse/src/oduse/tests/window.rs` (GAP-4)

```rust
/// The notification is the one place the cap decision is actionable while the
/// app runs: a mixed store must use the stricter $10 5-hour cap, not the $18
/// Eco one the plan's headline advertises.
#[test]
fn a_mixed_store_notifies_against_the_stricter_cap() {
    let now = super::fixture::NOW_MS;
    let rows = vec![
        super::fixture::row(now - 60_000, "deepseek-v4.1-flash", 0, 0),
        super::fixture::row(now - 60_000, "deepseek-v4.1-flash-eco", 0, 0),
    ];
    let since = crate::oduse::window::calendar_month_start(now);
    let mut report = build(&rows, &catalog(), od::DEFAULT_PLAN, now, Some(since));
    report.five_hour.credits = 11.0; // over Flash's $10, under Eco's $18
    assert_eq!(over_window(&report, &plan("go")), Some("5-hour"));
    report.five_hour.credits = 9.0;
    assert_eq!(over_window(&report, &plan("go")), None, "within both caps");
}
```

### For `cmduse/src/oduse/tests/caps.rs` (GAP-5)

```rust
/// Each row names the looser figure for its own window, not the monthly one
/// repeated three times.
#[test]
fn the_cap_note_names_each_windows_own_looser_figure() {
    let rows = vec![
        row(NOW_MS - 60_000, "deepseek-v4.1-flash", 1_000_000, 0),
        row(NOW_MS - 60_000, "deepseek-v4.1-flash-eco", 1_000_000, 0),
    ];
    let text = render::render_text(
        &super::fixture::report(&rows),
        &plan("go"),
        "/tmp/a.db",
        10,
        false,
        DEFAULT_BAR_WIDTH,
    );
    let line = |label: &str| -> String {
        text.lines().find(|l| l.contains(label)).expect("row").to_string()
    };
    assert!(line("5-hour").contains("Eco would be $18.00"), "{}", line("5-hour"));
    assert!(line("Weekly").contains("Eco would be $55.00"), "{}", line("Weekly"));
}
```

### For `cmduse/src/oduse/tests/elapsed.rs` (GAP-6, optional)

```rust
/// A period that has not started has no share to print — the frame says the
/// elapsed figure is unknown rather than clamping it to 0.0%.
#[test]
fn a_period_before_its_start_has_no_share() {
    let day = 86_400_000;
    let mut report = super::fixture::report(&[row(NOW_MS - 60_000, "glm-5.3-flash", 1_000, 10)]);
    report.since_ms = NOW_MS + 5 * day;
    report.period_end_ms = Some(report.since_ms + 10 * day);
    report.period_anchored = true;
    let line = monthly_line(&report);
    assert!(line.contains("window — elapsed unknown"), "{line}");
    assert!(!line.contains("% elapsed"), "{line}");
}
```

## 4. One adjacent discrepancy, not strictly a gap

`render/catalog_json.rs:42` comments `capSet` is "Absent on a plan with one
published set", and `caps.rs::default_cap_set` fills `id` from the plan label
("Pro"), so `models --json` on Pro emits `"capSet": "pro"` rather than null.
No test pins either reading. A consumer branching on `capSet == null` to mean
"one set" would misread Pro/Max. Cosmetic label, low cost, but worth settling
in the same pass — GAP-1's Pro assertions above deliberately check only the
cap figure so they do not accidentally ratify the wrong `capSet` contract.
