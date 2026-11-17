# Lane report — per-model caps and an honest elapsed clock

Branch state: `main`, HEAD `ee61977`, tree dirty by design (no commit, no branch).
Scope touched: `core/od.json`, `cmduse/src/oduse/**`, plus the repo docs this file lives in.

## Step 0 — what the code did before

Read state, no edits yet:

- `core/od.json` has ONE cap block per plan (`monthlyUsd`/`weeklyUsd`/`fiveHourUsd` on the
  plan object). Go's block is 220 / 55 / 18 — the **Eco** set — and `window::over_window`
  plus every renderer divides by it unconditionally.
- `cmduse/src/oduse/od.rs::Plan` deserialises exactly those three fields, so a per-model
  override has nowhere to live.
- `render/windows.rs::window_line` computes the elapsed share as
  `elapsed_pct(Some(period_end), dur, now)` where `dur = end - start` and start comes from
  `report.since_ms`. For the default (`--window month`) that start is
  `calendar_month_start(now)`, i.e. the **calendar month**, and a plan whose real cycle is
  the subscription anniversary gets a share of the wrong denominator. Nothing prints when
  the period is absent (`--window all`), so the row silently loses the figure instead of
  saying why.

## Step 1 — caps modelled per plan and per model class

`core/od.json` now carries, on Go only:

```json
"defaultCapLabel": "Eco",
"capOverrides": [
  { "id": "flash", "label": "Flash", "models": ["deepseek-v4.1-flash"],
    "monthlyUsd": 120, "weeklyUsd": 30, "fiveHourUsd": 10 }
]
```

The plan's own `monthlyUsd`/`weeklyUsd`/`fiveHourUsd` stay the default set (Go's
$220/$55/$18 = the Eco figures); `capOverrides` names models that draw a different
one. Plus/Pro/Max publish one set, so they carry no `defaultCapLabel` and no
`capOverrides` — Pro/Max have no Eco model at all.

`od.rs` gained `CapSet`, `Plan::default_cap_set()`, `Plan::cap_set_for(id)` and
`Plan::cap_pick(ids)`:

- `cap_set_for` answers the set one model draws on — its own override, else the
  plan default.
- `cap_pick` collects the distinct sets the window's spending models resolve to,
  sorts by monthly (then 7-day, then 5-hour) and picks the **stricter**; it keeps
  the plan default beside it as `looser` only when that default is genuinely wider,
  so a single-set plan reports nothing extra.

`window/mod.rs` gained `Span` (`FiveHour`/`Weekly`/`Month`) and
`window_caps(models, plan, span)` — the resolver every renderer and the cap
notification now call. `over_window` reads it per window, so the notify verdict
uses the same cap the frame prints.

## Step 2 — every surface reads the picked set

| surface | before | after |
| --- | --- | --- |
| dashboard window rows | `plan.monthly_usd` etc. | `window_caps(...)` per row, plus `cap_note` |
| `over_window` (cap notify) | plan's caps | same pick the frame prints |
| `statusline` `{month_pct}` / `{week_pct}` / `{5h_pct}` | plan's caps | the pick per window |
| `statusline --json` | `monthCap` = plan's | the pick, plus `capLabel` |
| `-1 --json` | `caps` only | `caps` (plan's set + `capOverrides`) and `capPicks` per window |
| `plans --json` | one cap block | plus `defaultCapLabel` and `capOverrides[]` |
| `models --json` | plan's caps on every row | that model's own set, plus `capSet`/`capLabel` |

The frame's row for a mixed window now reads e.g.

```
  Monthly  $3.20 · 2.7% of $120.00 (Flash caps; Eco would be $220.00)
```

`cap_note` is only attached where an override actually won, so a single-set plan
(Pro/Max) prints no note at all.

## Step 3 — the elapsed clock (defect 2)

`Report` gained `period_anchored`, set from a new `Period.anchored`, which is true
only where the caller named the boundary:

| period source | anchored | why |
| --- | --- | --- |
| `--since <ISO>` | yes | the caller pinned an instant |
| `--period-start <date>` | yes | the caller pinned a day |
| `--infer-anniversary` | yes | the anniversary is the plan's own cycle |
| `--window month` (default) | **no** | the plan's cycle is the anniversary, not the calendar |
| `--window all` / `--window <n>d` / `model --days N` | no | a local cut, not a plan boundary |

`window_line` now prints `window N% elapsed · $M by now` only when the span is
anchored; otherwise the monthly row prints `no period anchor` and no percentage.
The `ends <date>` half is a fact and still prints. `elapsed_pct` returning `None`
inside an anchored span prints `window — elapsed unknown` instead of vanishing.

Before (this machine, `oduse -1`): the Monthly row read
`$x · y% of $220.00 · ends 2026-12-01 · window 54.6% elapsed · $N by now` — 54.6%
of a **calendar** month, which the plan never used.

## Step 4 — `mpc --od-plan` has the same wrong assumption (report only, not edited)

`oc-cmd-compare/src/data/sources/od/index.ts:35-42` derives allowance as
`pool / model.multiplier`, where `pool = def.credits` for a `coding` row and
`def.top` for a `top` row. `src/data/sources/od/plans.ts` gives Go `credits: 220`,
so **both** DeepSeek V4.1 Flash (x0.5) and Flash Eco (x0.27) are handed the same
$220 pool scaled only by multiplier. That is the single-pool mistake: the real
Flash cap is $120/mo and Eco is $220/mo, so Flash's requests/month and `allowance`
are overstated by ~1.83x even though its multiplier is right.

What it should do (for a later pass; this lane does not own `oc-cmd-compare`):
read the cap set per model from `oduse plans --json` (`capOverrides[]` plus
`defaultCapLabel`), choose the set that model draws on, and divide **that** cap
by the multiplier; for a mixed workload take the stricter set, as `oduse`
does. Top-model credits stay a separate pool, as they are now. Add a matching
fixture for Go Flash = $120 and Go Eco = $220.

## Step 5 — before/after on this machine (hand check)

`timeout 60 ./target/debug/oduse -1 --no-wallet` (both models in the month):

Brief's reported before (the exact cents in this machine's frame were not captured before the first edit): `window 54.6% elapsed · $N by now` on a `2026-11-01 → 2026-12-01` calendar month, with every row divided by `$220.00`. After:

```
DESIGN Go $220.00/month · $55.00/week · $18.00/5h · 10 concurrent (per model: Flash $120.00/mo; Eco $220.00/mo)
  5-hour   $1.93 · 19.3% of $10.00 (Flash caps; Eco would be $18.00) · rolling 5h
  Weekly   $3.71 · 12.4% of $30.00 (Flash caps; Eco would be $55.00) · rolling 7d
  Monthly  $3.71 · 3.1% of $120.00 (Flash caps; Eco would be $220.00) · ends 2026-12-01 · no period anchor
```

Hand check: month credits $3.71 ÷ $120 = 3.09%, printed 3.1%. The 5-hour row
$1.93 ÷ $10 = 19.3%; under the old Eco cap it read 10.7% of $18. The calendar
share the frame used to print is gone.

`plans --json` now carries `capOverrides` only on Go; `models --json` reports
`capSet: flash, monthCapUsd: 120` for Flash and `capSet: eco, monthCapUsd: 220`
for Eco. `model --window all --no-wallet` prints `no period anchor` with no
percentage.

## Step 6 — gates and tree state

- `cargo test` (whole workspace): green.
- `cargo fmt --all -- --check`: green.
- `cargo clippy --all-targets -- -D warnings`: green.
- All files touched by this lane stay under the 200-line cap; the cap resolver,
  cap prose and the extra tests were split into their own files to hold it.
- `git status` also shows changes under `opencode-plugin/` and new files there
  (`src/sidebar/od-*`, `test/sidebar-od-*`) that this lane did **not** write and
  did not touch — another session's work. Nothing there was reverted, staged or
  committed. Branch remains `main`; no commit, push, branch or stash by this lane.
