# Lane Q (CORRECTED) — `ocuse`: keep the blended percent, and stop implying a cap

Repo `/Users/jyz/dev/cmdcode-tools`. Rust workspace: `core/` (`cmduse-core`, pure logic), `cmduse/` (bins
`cmduse`, `ocuse`, `arkuse`, `oduse`).

> **This brief replaces the earlier one. The earlier instruction — "compute the percentage against the
> current cap" — was wrong and is withdrawn.** The blend is the accurate utilization, because the spend was
> made against $80 earlier and $100 later. 69.7% is only what today's cap implies; it is not "how used up am
> I". If you already wrote the current-cap-as-headline version, undo that part.

## The case

`ocuse --json`, period 2026-11-13 → 2026-12-13, DeepSeek V4.1 Flash's allowance raised $80 → $100 about a
third of the way in. Spend $70.08.

```
account.monthly.percent  76      the endpoint's own number
summary.cost             70.229  local dollars
model month.cost         69.873  local dollars for that model, limit 100 today
```

Two real faults, and one non-fault:

- **Not a fault:** the endpoint's ~75% is right. It is the time-weighted figure against the allowance that was
  actually available (80 for a third of the window, 100 after).
- **Fault 1:** the output shows a percentage with no statement of what it is a percentage *of*, so it reads as
  "70.08 of 93.4" and contradicts the per-model row.
- **Fault 2:** `cmduse/src/ocuse/render.rs:268` `implied_cap(spend, share_pct)` turns a percentage into a
  dollar ceiling and feeds it to the pace calculation. A blend is not a single cap, so this number is
  meaningless exactly when the allowance moved.

## What to build

1. **Blended headline, computed locally.** Add one pure helper to `cmduse-core`:
   `weighted_allowance(spans: &[(cap, from_secs, to_secs)], window_start, now) -> Option<f64>` plus
   `share_of(spend, allowance) -> Option<f64>`. The headline month percentage is
   `month.cost / weighted_allowance` × 100, over the **elapsed** part of the window only (caps weighted by the
   time each was in force while the window has run — not the whole month).
   With 80 for the first third of the elapsed window and 100 after, spend 70 → **75%**.
2. **Show the current-cap figure separately and label it.** Its own row/field:
   `$69.87 of $100 at today's limit (69.9%)`. Both numbers, each saying what it is.
3. **Say why they differ, in the output.** One dim line when the cap moved inside the window:
   `allowance raised $80 → $100 during this period`. This is the only reason a blend and a current-cap figure
   disagree, and hiding it is what makes the output look self-contradictory.
4. **Keep the endpoint's number as corroboration.** `percentSource`: `"blended"` once cap history is known,
   `"server"` when it is not (a fresh install has no history, so the endpoint's figure is the only blend
   available). Carry `serverPercent` unchanged and never overwrite it. When history exists and the local
   blend and the server disagree by more than a point, say so in a note — that is a real signal (the clamp
   changed somewhere we did not sample), not something to paper over.
5. **Remove the cap inference everywhere.** `implied_cap` must leave the display *and* the pace path. Pace
   uses the published/weighted allowance and abstains when there is none. No printed dollar/percent pair may
   multiply back to a cap the source never published — `$70.08 of $100 (70.1%)` is fine, `$70.08 (75%)` is
   not.
6. **Cap history on disk**, in the catalogue cache dir (`$CMDUSE_CACHE_DIR`, default `~/.cache/cmduse/`): on
   each catalogue load compare each model's limit (and each plan's window share) with the last recorded value
   and append `{model, from, to, at}` on a real change. Never append on first run, never when the load came
   from the baked seed, never rewrite history. The blend is computed from these spans.
7. **JSON contract.** Keep `account.monthly.percent` as the **blend** (now computed locally when history
   allows). Add `account.monthly.percentSource`, `account.monthly.serverPercent`,
   `account.monthly.currentCap`, `account.monthly.currentCapPercent` and top-level `capChanges:
   [{model, from, to, at}]`. `statusline --json`'s `month_pct` follows the blend. Update `cmduse/README.md`
   and `cmduse/cmduse.1` for the new fields and for what the headline percentage means.

## Tests (name them exactly this way)

- `blended_percent_weights_each_cap_by_its_time_in_force` — 80 for the first third of the elapsed window,
  100 after, spend 70 → **75.0**, not 70.0.
- `the_current_cap_figure_is_shown_beside_the_blend_and_labelled` — same fixture renders `$70.00 of $100`
  with 70.0% in its own labelled field/row, and the blend stays 75.0 in the headline.
- `a_mid_period_cap_rise_is_named_in_the_output` — the rendered text contains `raised`, `80`, `100`.
- `a_dollar_and_percent_never_imply_a_cap` — no rendered pair multiplies back to a cap other than the
  published one.
- `cap_history_appends_only_on_change_and_ignores_the_baked_seed` — first run writes nothing, an unchanged
  reload writes nothing, a changed reload appends once, a baked-seed load appends nothing.
- `pace_uses_the_weighted_allowance_and_abstains_without_one` — no allowance, no pace claim.
- `an_empty_history_falls_back_to_the_server_percent` — no spans → `percentSource == "server"`, value
  unchanged.

## Constraints

- Own: `core/src/lib.rs` (helper + tests), `core/src/reports.rs` only if aggregation needs it,
  `cmduse/src/ocuse/**`, `cmduse/README.md`, `cmduse/cmduse.1`. Nothing in `cmduse/src/oduse/**`,
  `arkuse/**`, `cmduse/**` (the CommandCode half), `oc-cmd-compare/**` or `aa-models/**`.
- `cmduse-core` stays pure: no I/O, no HTTP. The history file lives in `cmduse/`.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`, and never pass `-r` to `rg`.
- Gate, foreground: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.
  No version bump, tag, publish, `AGENTS.md` or commit — leave the work in the tree.

Report to `docs/plan/percent-audit/lane-q.md`: the helper signature, the blend rule, the JSON fields, every
test name with its assertion, and a live `ocuse --json` + `ocuse` run showing both figures.

---

# Lane Q — report

## Helpers (pure, in `core/src/lib.rs`)

- `pub fn weighted_allowance(spans: &[(f64, i64, i64)], window_start: i64, now: i64) -> Option<f64>`
  — each span is `(cap, from_secs, to_secs)`; only the part overlapping the
  **elapsed** window counts. `None` when no span overlaps (no allowance known).
  $80 for the first third and $100 after → 280/3 = $93.33.
- `pub fn share_of(spend: f64, allowance: f64) -> Option<f64>` —
  `spend / allowance × 100`, multiply-rounded to one decimal; `None` when the
  allowance is not positive. Shared by the blend and the current-cap figure so
  the two can never disagree on rounding.

## Blend rule

`account.monthly.percent = share_of(model.month.cost, weighted_allowance(spans))`
where spans are reconstructed from `capChanges` (`from` is the cap before the
first sampled change, each `to` runs until the next). The headline uses the
**elapsed** part of the window only. When no change was sampled the endpoint's
figure stands unchanged and `percentSource == "server"`.

`implied_cap` is gone from both the display and the pace path. Window rows now
print the published per-model cap and its 20/50/100% share —
`$30.00 of $60 (50.0%)` — never a ceiling back-solved from a percentage. Pace
and `$X by now` use the weighted allowance for the month (published cap for the
two throttles) and abstain when no allowance is published.

## Cap history

`cmduse/src/ocuse/catalogue/history.rs` writes
`$CMDUSE_CACHE_DIR/ocuse-cap-history.json` (default `~/.cache/cmduse/`) on each
live/cached catalogue load. First run writes a baseline only; an unchanged
reload writes nothing; a real limit change appends `{model, from, to, at}` once;
a baked-seed load is read-only. Tracks the default plan's per-model limits and
the shared window split. Sampled once at `catalogue::init`, read by
`window::apply_cap_history` when each report is built.

## JSON fields

- `account.monthly.percent` — the local blend when history sampled a change,
  otherwise the endpoint's number (was always the endpoint's).
- `account.monthly.percentSource` — `"blended"` | `"server"`.
- `account.monthly.serverPercent` — the endpoint's figure, carried unchanged.
- `account.monthly.currentCap` and `account.monthly.currentCapPercent` — the
  separately labelled today's-cap figure.
- `account.monthly.note` (optional) — present when local blend and console
  disagree by more than a point.
- top-level `capChanges: [{model, from, to, at}]` — empty on a fresh install.

Scope note (superseded by the follow-up below): `statusline --json` initially
had no `month_pct` key because registering it needs an edit to the shared
`cmduse/src/report_render.rs`. The coordinator has since authorized that file;
the follow-up adds `month_pct` and `month_pct_source`.

## Tests (exact names)

Core (`core/src/lib.rs`):
- `blended_percent_weights_each_cap_by_its_time_in_force` — 80 for the first
  third of 300s, 100 after → weighted allowance 280/3 and `share_of(70, …) == Some(75.0)`, not 70.
- `share_of_abstains_without_a_positive_allowance` — zero and negative caps give `None`.
- `weighted_allowance_ignores_time_outside_the_elapsed_window` — no overlap,
  zero elapsed, and future-only spans all give `None`.

Cap history (`cmduse/src/ocuse/catalogue/history.rs`):
- `cap_history_appends_only_on_change_and_ignores_the_baked_seed` — first run
  writes no entries, unchanged reload rewrites nothing, a $100 → $120 change
  appends exactly one `{model, from, to, at}`, and a baked-seed load neither
  appends nor rewrites.

Window (`cmduse/src/ocuse/window.rs`):
- `an_empty_history_falls_back_to_the_server_percent` — no spans keeps 76,
  `percentSource == "server"`, `serverPercent == 76`, no current cap.

Rendering (`cmduse/src/ocuse/render.rs`):
- `the_current_cap_figure_is_shown_beside_the_blend_and_labelled` — text has
  `75.0% blended of limit` and `$70.00 of $100 (70.0%) — current cap…`; JSON
  has percent 75, `percentSource: "blended"`, `serverPercent: 75`, currentCap
  100, currentCapPercent 70.
- `a_mid_period_cap_rise_is_named_in_the_output` — text contains `allowance
  raised $80 → $100 during this period`, and `capChanges` has one entry.
- `a_dollar_and_percent_never_imply_a_cap` — the pair divides to 70/100 =
  70%; the blended headline carries no dollar denominator; no invented cap.
- `pace_uses_the_weighted_allowance_and_abstains_without_one` — a free model
  with no published limit prints no pace and no by-now; with history the
  monthly by-now uses the 93.33 weighted allowance.
- `a_reachable_cap_gets_the_pace_line` — pace now comes from a published cap,
  not a percentage-derived one.

## Gates (foreground, all green)

`cargo test --workspace` 364 passed / 0 failed ·
`cargo fmt --all -- --check` clean ·
`cargo clippy --all-targets -- -D warnings` clean.

## Live runs

Real account and real `opencode.db` (period 2026-11-13 → 2026-12-13). To show
both figures I used a temp `CMDUSE_CACHE_DIR`: a first `ocusedev` run against a
catalogue with DeepSeek at $80 established the baseline, a second with the real
$100 catalogue recorded the real `80 → 100` change through the code path, and
the change timestamp was then set to one third into the elapsed window (the
fixture the brief describes). The user's real cache was cleaned up afterwards.

`ocusedev -1 --json`:

```json
{
  "monthly": {
    "currentCap": 100.0,
    "currentCapPercent": 69.9,
    "note": "local blend 74.9% differs from the console's 76% by more than a point; the allowance may have moved outside the sampled window",
    "percent": 74.9,
    "percentSource": "blended",
    "serverPercent": 76.0,
    "status": "ok"
  },
  "capChanges": [
    { "at": 1794849200355, "from": 80.0, "model": "deepseek-v4.1-flash", "to": 100.0 }
  ],
  "summary": { "cost": 70.28831778600032, "requests": 72336 }
}
```

`ocusedev -1 -p` (same cache):

```
period: Go billing month · ends 2026-12-13 · 72.3K requests · $70.29 · 262.4M in / 42.1M out tokens · 74.9% blended of limit
  Monthly  $70.29 of $100 (70.3%) · resets 20d 0h · on pace to hit cap in 3d 6h · window 33.3% elapsed · $31.08 by now
  today's limit  $69.93 of $100 (69.9%) — current cap, not the period blend
  allowance raised $80 → $100 during this period
```

74.9% (blend) ≈ the brief's 75%; 69.9% is today's-cap figure. The optional note
fires because the 74.9% local blend and the console's 76% differ by more than a
point — the real signal described in the brief. A default run with no history
printed `76% of limit (server)`, an empty `capChanges` and no current-cap row.

Work left uncommitted; tree on `main` (the coordinator's branch is
`refactor/mpc-aa-models`).

---

# Lane Q — follow-up (three real-store gaps)

All three found by the coordinator running the real command against the real
store, not a fixture. Fixed and re-proved with the same commands.

## Fixes

1. **`currentCap` / `currentCapPercent` no longer come from history.**
   `window::apply_cap_history` now always picks the model actually used (the
   model whose cap moved inside the window, else the largest spender that has
   a published limit) and reads its limit from the catalogue. History is used
   only to decide whether a time-weighted blend can replace the headline. A
   fresh install with an empty `capChanges` now fills both fields.
2. **No-history basis moves are explained without inventing a cap.** When no
   spans exist, `server` stays the `percentSource`, but a gap of more than a
   point against `currentCapPercent` produces a note:
   `the allowance changed during this period (DeepSeek V4.1 Flash 1017); the
   server meters 76%, today's cap implies 69.9%`. The model is named only when
   one model accounts for ≥90% of the period spend; no old value and no
   `$80 → $100` span is invented without a real sampled change. With history,
   the existing `$80 → $100` line still prints.
3. **`statusline --json` follows the blend.** Added `month_pct` (the blend, or
   the server figure with no history, or `null` without an account) and
   `month_pct_source` (`"blended"`/`"server"`), and registered both in
   `cmduse/src/report_render.rs::STATUSLINE_EXTRA_KEYS` so the shared-key test
   stays green. The coordinator authorized editing that file for this.

## New tests (exact names)

- `the_current_cap_figure_is_filled_without_history` (`window.rs`) — empty
  history, DeepSeek spend $69.873: `current_cap == Some(100.0)`,
  `current_cap_percent == Some(69.9)`, `percent_source == "server"`,
  `percent == 76.0`, no spans.
- `a_server_cap_basis_that_moved_is_explained_without_history` (`render.rs`) —
  no history: text carries the server headline and the current-cap pair, the
  note names the model and both figures, contains no `80` and no `→`, and
  `capChanges` is empty; JSON carries the note and the filled cap fields.
- `statusline_month_pct_follows_the_blend` (`render.rs`) — blend case gives
  `month_pct: 75.0` / `month_pct_source: "blended"`, server case gives
  `76.0` / `"server"`, no-account case gives `null`; all three pass
  `assert_statusline_keys`.

## Gates

`cargo test --workspace` 367 passed / 0 failed ·
`cargo fmt --all -- --check` clean ·
`cargo clippy --all-targets -- -D warnings` clean (all foreground).

## Real-store proof (same command, two cache states)

Fresh install (temp cache with the real catalogue, **no** history file) —
`ocuse --json`:

```json
{
  "monthly": {
    "currentCap": 100.0,
    "currentCapPercent": 69.9,
    "note": "the allowance changed during this period (DeepSeek V4.1 Flash 1017); the server meters 76%, today's cap implies 69.9%",
    "percent": 76.0,
    "percentSource": "server",
    "resetsAt": 1797153275000,
    "serverPercent": 76.0,
    "status": "ok"
  },
  "capChanges": [],
  "summary": { "cost": 70.29727122600032, "requests": 72392, "tokens": 15996854728 }
}
```

Same run, `ocuse statusline --json`:

```json
{
  "month_pct": 76.0,
  "month_pct_source": "server",
  "monthSpent": 70.29727122600032,
  "monthCap": null
}
```

With a real sampled $80 → $100 change a third into the window (temp cache,
same real store), `ocuse --json`:

```json
{
  "monthly": {
    "currentCap": 100.0,
    "currentCapPercent": 69.9,
    "note": "local blend 74.9% differs from the console's 76% by more than a point; the allowance may have moved outside the sampled window",
    "percent": 74.9,
    "percentSource": "blended",
    "serverPercent": 76.0,
    "status": "ok"
  },
  "capChanges": [
    { "at": 1794849414480, "from": 80.0, "model": "deepseek-v4.1-flash", "to": 100.0 }
  ]
}
```

Same run, `ocuse statusline --json`:

```json
{ "month_pct": 74.9, "month_pct_source": "blended" }
```

`month_pct` equals 76.0 with no history and 74.9 with a blend — it no longer
follows the server blindly. Temp cache dirs were removed; the real cache was
not modified by these runs. Still uncommitted.
