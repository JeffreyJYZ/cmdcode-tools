# Verify report — oduse per-model caps and the elapsed clock

Verifier lane. Checked the sibling lane's `cmduse/src/oduse/**` + `core/od.json` diff against
`docs/plan/opendesign/reference/od-caps.json`, its README, and the sidebar contract in
`docs/plan/opendesign/reports/sidebar-per-model-caps.md`. Branch `main` at `ee61977`, tree left dirty
(no commit, push, branch or stash). Did not touch `opencode-plugin/` or `oc-cmd-compare`.

## Findings

### 1. Go + Flash = 120/30/10, Go + Eco = 220/55/18 — RIGHT, no change
`core/od.json` keeps the Eco set as the plan default ($220/$55/$18) and adds the Flash override
($120/$30/$10). `core/od.json:24-34`. Proof: test `go_caps_are_per_model_class`
(`cmduse/src/oduse/tests/caps_data.rs:11`) asserts both triples, both ids and both labels, plus the
fallback for a model with no override. Live `models --json --plan go` confirms the Flash row
reports `monthCapUsd:120 / weeklyCapUsd:30 / fiveHourCapUsd:10 / capSet:flash`.

### 2. Mixed window takes the stricter set and names both — RIGHT, no change
`Plan::cap_pick` (`caps.rs:78`) de-dups by set, sorts monthly then weekly then 5h, picks the
smallest; `CapPick.looser` carries the plan default only when it is looser. `cap_note`
(`render/caps.rs:12`) prints `Flash caps; Eco would be $220.00`. Proofs:
`a_mixed_window_takes_the_stricter_set_and_keeps_the_other` (caps_data.rs:39) and
`a_mixed_window_names_the_cap_set_it_used` (caps.rs:11, asserts $120 month / $30 week / $10 5h and
the named alternative). Live frame (built before the fix; caps/elapsed lines unchanged by it):
`Monthly $3.80 · 3.2% of $120.00 (Flash caps; Eco would be $220.00) · ends 2026-12-01 · no period anchor`.

### 3. A plan with no per-model split still resolves — RIGHT, no change
Pro/Max/Plus carry no `capOverrides`; `cap_set_for` falls back to `default_cap_set` and
`cap_pick` yields one set with `looser: None`, so no cap note is grown. Proof:
`pro_has_one_set_and_no_eco_row` (caps_data.rs:102) and `a_single_set_plan_prints_no_cap_note`
(caps.rs:46). Live `-1 --plan pro` prints `DESIGN Pro $480.00/month · $90.00/week · 30 concurrent`
with no `of $…` note; `plans --json` shows empty `capOverrides` for plus/pro/max.

### 4. JSON shape the sidebar consumes — ONE WRONG CASE, FIXED
`plans --json`, `models --json` and `-1 --json` all emit `caps.capOverrides` and top-level
`capPicks` (`render/catalog_json.rs`, `render/json.rs`); live `plans --json` and `-1 --json` confirm
the exact `capOverrides` entries and `capPicks` objects.

Wrong: `render/json.rs` used one `pick` closure for all three windows and stamped
`planDefaultMonthlyUsd` with `l.monthly_usd` every time. So `capPicks.fiveHour` and `.weekly`
carried **$220**, while the sidebar fixture
(`opencode-plugin/test/sidebar-od-permodel.test.ts:171-175`) expects the per-window looser figures
$220 / $55 / $18, and `applyPick` reads that key for each window. The panel would have named
`Eco $220` as the 5-hour and weekly alternatives where the real ones are $18 and $55.

Fix: `pick` now takes a `Span` and reads `five_hour_usd` / `weekly_usd` / `monthly_usd` from the
looser set per window. The key name is kept so the sidebar needs no change. Added assertions for
all three values to `the_json_surface_is_the_family_shape` (render_json.rs:90). Live re-check:
`capPicks = {monthly:220, weekly:55, fiveHour:18}`, ids `flash`, labels `Flash`.

Also found and fixed the same headline-denominator mistake in the tiny-terminal compact watch
line: `render/live.rs::compact_line` divided spend by `plan.monthly_usd` ($220) with no set name.
It now divides by `window_caps(…, Span::Month).chosen` and prints the label. New test
`the_compact_line_uses_the_chosen_set` (caps.rs:77) asserts `$120.00`, `(Flash)`, and no `$220.00`.
The full frame, statusline template, statusline JSON, MCP usage path and `over_window` already use
`window_caps`; only `compact_line` was missed.

### 5. Monthly elapsed share from the frame's own period or no anchor — RIGHT, no change
`period.rs` sets `anchored` true only for `--since`, `--period-start` and the inferred
anniversary; false for calendar month, `--window all` and plain `N` days. `render/windows.rs`
prints `no period anchor` when unanchored or boundary-less, and the arithmetic share only when
anchored. Proofs in `tests/elapsed.rs`: `a_pinned_period_yields_the_arithmetic_share` (25.0%),
`a_period_with_no_end_has_no_percentage`, `a_calendar_month_is_not_an_anchor`,
`the_anniversary_inference_yields_a_share_from_that_boundary`. Live: default and `--window all`
print `no period anchor`; `--period-start 2026-11-07` prints `window 34.7% elapsed · $41.64 by now`;
`--infer-anniversary` prints `window 4.7% elapsed · $5.64 by now` with `ends 2026-12-16`.

## Gate (after the fix)
- `cargo test -p cmd-usage oduse` — 89 passed, 0 failed (was 88 before the two new tests).
- `cargo fmt --all -- --check` — clean.
- `cargo clippy -p cmd-usage --all-targets -- -D warnings` — clean.
- TUI probes bounded with `timeout` (5s / 120s).

## Out of scope, named not changed
- Plus publishes two cap sets in the reference ($290/$74 Eco vs $160/$40 Flash, no 5h), but
  `core/od.json` gives plus one set (monthlyUsd 310 = Coding 290 + Top Model 20). The brief scoped
  the Eco/Flash pair to Go as "the first real case" and the five checks name only Go and Pro/Max,
  so this was left untouched. If per-model caps are extended beyond Go, Plus needs an override.
- mpc's allowance derivation (`credits ÷ multiplier`, one pool) was not inspected or edited here;
  the brief assigns that report to the sibling lane.
