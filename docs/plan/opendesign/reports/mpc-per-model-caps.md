# Lane report — mpc: per-model OpenDesign caps

Branch state: `main`, HEAD `ee61977`, tree dirty by design (no commit, no branch, no push).
Scope touched: `oc-cmd-compare/` only, plus this report. `cmduse/` and `opencode-plugin/` untouched.

## Step 0 — authority and what the code did

Authority: `docs/plan/opendesign/reference/od-caps.json` + `reference/README.md`, both fetched
2026-11-17. Go publishes two cap sets (`deepseek-v4.1-flash-eco` $220/$55/$18;
`deepseek-v4.1-flash` $120/$30/$10), Plus two ($290/$74/— and $160/$40/—); Pro/Max one each
($660/$90/—, $1,110/$150/—). Quotes in the reference: pricing.md §Go, /help/billing §When do
the limits reset?, /pricing §Coding Plan usage (two separate rows).

Before: `src/data/sources/od/index.ts::allowanceOf` returned `pool / model.multiplier` with
`pool = def.credits` for every coding model. `windowRatios` in `src/cli/engine/cost.ts` scaled
every OD window by the plan-level `plan.fiveHour / plan.credits` and `plan.weekly / plan.credits`.
So Flash was priced off Eco's $220 pool and Eco's 55/18 windows: $440 allowance instead of the
published $120, and $30/$10 windows became $55·(440/220)/$18·(440/220). The plan-level window
percentages in `--check` and the footer carried the same single-pool assumption; `$1K` and
COST/VAL inherited it through `payPerRequest` and `requestsPerMonth`.

## Step 1 — caps modelled per plan and per model class

`src/data/sources/od/plans.ts` now carries `caps` (keyed by `normalizeKey(model.name)`) and
`defaultCaps` on Go and Plus, with the reference's figures verbatim. Pro and Max carry no
`caps`: they publish one pool covering every Coding Plan model, so their allowance stays
`plan credits ÷ multiplier` and their plan-level windows are unchanged. The reference records
the Pro/Max coding maximum as an open conflict ($360/$600 vs $660/$1,110); that conflict is
out of scope here and the existing values were left alone, so no number was invented.

`types.ts` gained a `CapSet` (`month`, `week`, `fiveHour`) and an optional `CatalogEntry.cap`.
`od/index.ts` gained `capFor(model, planId)`, returns the model's own set, else `defaultCaps`,
else null; top models draw `top` credits with no multiplier and no cap. `allowance` is the
published `cap.month` directly on Go/Plus — no division — and the one-pool formula only on
Pro/Max. A plan with neither caps nor a pool leaves the model **absent**: `OdLoad.uncapped`,
never a zero cap.

## Step 2 — every derived figure follows the model's own cap

| surface | before | after |
| --- | --- | --- |
| `allowance` | `plan credits ÷ multiplier` for all | Go/Plus: published cap ($120 Flash, $220 Eco); Pro/Max: one pool ÷ multiplier |
| `requestsPerMonth` | `allowance ÷ cost` | unchanged formula, per-model input |
| `requestsPerFiveHour` / `requestsPerWeek` | plan-level 18/220 and 55/220 ratios | Flash 10/120 and 30/120; Eco 18/220 and 55/220; `null` window stays `0` (dash) |
| `$1K` / `req/$` | inherited the shared pool | inherit the model's own allowance and `payPerRequest` |
| COST / VAL volume term | built on the shared `requestsPerMonth` | built on each model's corrected count |
| `--check` | no cap output | prints every published cap set + default, and an `uncapped` count |
| footer / LEGEND OD | "allowance = credits ÷ multiplier" | states Go/Plus per-model caps vs Pro/Max pool |

`windowRatios` takes an optional `CapSet` and prefers it over plan-level figures; `--window`
still overrides both. `buildMetrics` passes `entry.cap` through.

## Step 3 — tests

New/updated in `test/data/od.test.ts` and `test/data/od-windows.test.ts`:

- Flash 120 vs Eco 220 on Go; Plus 160 vs 290 with `fiveHour: null`; a model with no row takes
  the default (Eco) set.
- Flash and Eco share token rates but resolve to different allowances and different absolute
  per-window request counts; window ratios 10/120 and 18/220.
- Pro: two models with 0.5× and 2× multipliers resolve to `pool/0.5` and `pool/2`, with no
  per-model cap — one pool.
- A plan with no caps and no pool reports the model in `uncapped` and emits no entry — absent,
  not zero.
- Top-model exclusion, unpriced-model reporting and the `--od-plan` JSON payload stay pinned.

## Step 4 — gate and version

`package.json` PATCH bumped 0.1.12 → 0.1.13. No `dist/` in this package (`files: ["src",
"LICENSE"]`, bin points at `src/index.ts`), so nothing to rebuild. README, footer and LEGEND
updated in the same change.

Gate from `oc-cmd-compare/`:

- `bun test` — 133 pass, 0 fail at the point my files were final.
- `bun check` — clean on my files; a sibling lane edited `src/constants/sources.ts` mid-run
  (adding required `usageKey`), leaving `test/unit/scrape.test.ts` red on an assertion that
  was not mine. Not reverted or patched here — owner's lane.
- `bun fmt --check` — clean.
- `bunx biome lint` — exit 0; one info (biome.json schema `2.6.3` vs installed `2.5.14`),
  pre-existing.

A live `mpc --json --od-plan go --shape off` could not be captured: the OpenCode docs scrape
answered `no model table parsed for the "Go" plan` (docs layout drift), also touched by the
sibling lane. All verification here is fixture-based; no number was read from a live run.
