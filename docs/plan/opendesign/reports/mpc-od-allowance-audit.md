# Lane report — mpc's OpenDesign allowance assumes one pool

Read-only audit. Tree at HEAD `ee61977`; other lanes' uncommitted `oduse`/sidebar work left untouched. No repo file edited outside `docs/plan/`.

**Method note.** The brief's literal command, `mpc --json --od-plan go --shape off`, does not produce JSON on this machine today: it exits 1 with `mpc: no model table parsed for the "Go" plan from https://opencode.ai/v2/docs/console/go/ — docs layout may have changed`. Cause is unrelated to this audit: `curl -sSL -w '%{http_code} %{url_effective}'` shows `/v2/docs/console/go/` 301 → `/docs/console/go/` 200, and the 200 page carries `aria-controls` but no `role="tab"`/`tabpanel` markers that `src/data/scrape/tabs.ts` keys on. The live OC table therefore never loads, so mpc aborts before building any OD row. To answer with real numbers I called the same production functions (`loadOdCatalog`, `odPlan`, `buildMetrics`, `OPTION_DEFAULTS`) from a temp script outside the repo, supplying only the `deepseek-v4.1-flash` price row that mpc itself would get from `opencode-plugin/src/catalog.ts:154-160` (`0.15 / 0.6 / 0.003`, cacheWrite `0`) through `priceKey` (`src/data/sources/od/models.ts:30-33`). Default workload is `800 input / 50,000 cache-read / 200 output` (`src/constants/cli.ts:7-11`), so `costPerRequest = (800*0.15 + 50000*0.003 + 200*0.6)/1e6 = $0.00039`.

## 1. Where the OD plan and allowance are built, and what prints today

Command: `rg -n 'od' src/data/sources/od/ src/cli/engine/` (from the brief), then targeted reads.

- `oc-cmd-compare/src/data/sources/od/plans.ts:22-32` — `OD_PLANS.go = { price: 10, credits: 220, coding: 220, top: 0, fiveHour: 18, weekly: 55 }`. One cap block per plan; Go's is the Eco set.
- `oc-cmd-compare/src/data/sources/od/models.ts:24,26-34` — `DeepSeek V4.1 Flash` has `multiplier: 0.5`; `DeepSeek V4.1 Flash Eco` has `multiplier: 0.27`, `plans: ["go","plus"]`, `priceKey: "deepseekv41flash"`. Both are `tier: "coding"` and both are offered on Go, so both draw `def.credits`.
- `oc-cmd-compare/src/data/sources/od/index.ts:35-42` — `allowanceOf`: `const pool = model.tier === "coding" ? def.credits : def.top; return pool / model.multiplier;`. The comment on 37-39 explicitly says a coding row can draw the whole combined maximum, i.e. one shared pool. `loadOdCatalog` calls it at line 72 and writes `entry.allowance`.
- `oc-cmd-compare/src/data/sources/od/index.ts:79-89` — `odPlan()` returns the *same* `credits/fiveHour/weekly` on the plan object, so the window math has no per-model input either.
- `oc-cmd-compare/src/cli/flow/collect.ts:33-34,64` — the OD side is built from these two local modules; nothing is read from `cmduse plans --json`.
- `oc-cmd-compare/src/cli/engine/index.ts:20-36` — `cost = costPerRequest(...)`, `requestsPerMonth = allowance / cost`, `requestsPerFiveHour = ratios.five * requestsPerMonth`, `requestsPerWeek = ratios.week * requestsPerMonth`, `payPerRequest = plan.price * cost / allowance`.
- `oc-cmd-compare/src/cli/engine/cost.ts:36-41` — `windowRatios` for OD is `fiveHour / credits` and `weekly / credits`, again plan-wide.

Test proof of the intent: `cd oc-cmd-compare && bun test test/data/od.test.ts` → `10 pass, 0 fail, 32 expect() calls`; `test/data/od.test.ts:46` asserts Flash `allowance ≈ 440` and line 57 asserts only `eco.allowance > flash.allowance` — no test pins either to the vendor's published caps.

## 2. What the two rows carry today

Literal command result (exit 1, empty stdout):

```
$ mpc --json --od-plan go --shape off
mpc: no model table parsed for the "Go" plan from https://opencode.ai/v2/docs/console/go/ — docs layout may have changed
```

Rows from the same production path, driven by the temp probe (`bun <tmp>/od-allowance-probe.ts`, run with cwd `oc-cmd-compare`); the probe prints `rows[]` from `buildMetrics` exactly as `renderJson` would serialize them:

| model | allowance | requestsPerMonth | requestsPerFiveHour | requestsPerWeek |
| --- | --- | --- | --- | --- |
| `deepseek-v4.1-flash` | **440** | **1,128,205.13** | 92,307.69 | 282,051.28 |
| `deepseek-v4.1-flash-eco` | **814.8148148148148** | **2,089,268.76** | 170,940.17 | 522,317.19 |

**Different.** Eco gets ~1.85× Flash's allowance, and both are derived from the same `$220` pool by dividing by the multiplier. The vendor's own pairs are $220 vs $120 of *credit-pool* maximum, not $220 vs $220. Flash's row is the wrong one: it uses the Eco pool.

## 3. What the two rows ought to read

The published pairs are credit-dollar caps per *model class* (Eco $220/$55/$18, Flash $120/$30/$10). mpc's `allowance` and request counts stay in list-price dollars of usage, so the arithmetic is `cap / multiplier` with the correct cap per model, and the window ratios are `cap5h / capMonth`, `cap7d / capMonth`. This is the same model the other lane encoded in `core/od.json:9,24-34` (`defaultCapLabel: "Eco"` + a `capOverrides` entry for `deepseek-v4.1-flash` at 120/30/10) and recommended at `docs/plan/opendesign/reports/per-model-caps.md:108-113`.

Probe: `bun <tmp>/od-allowance-corrected.ts` — feeds `buildMetrics` one plan per cap set with the same price and pricing.

| model | pool used | allowance | requestsPerMonth | requestsPerFiveHour | requestsPerWeek | $/1K |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek-v4.1-flash` | $120 / 30 / 10 | **240** | **615,384.62** | 51,282.05 | 153,846.15 | $0.0163 |
| `deepseek-v4.1-flash-eco` | $220 / 55 / 18 | **814.8148148148148** | **2,089,268.76** | 170,940.17 | 522,317.19 | $0.0048 |

So Eco is already right by accident (plan defaults *are* the Eco set); Flash is overstated by `440/240 = 1.833×` on allowance and requestsPerMonth, and its 5h/wk figures by the same factor (`92,307.69 → 51,282.05`, `282,051.28 → 153,846.15`). `$/1K` for Flash is understated `0.0089 → 0.0163`. The `priceKey` sharing is kept: both rows still price at the base model's token rates, which is the documented mpc choice, not part of this defect.

## 4. Everything else in the OD column that inherits the one-pool assumption

All of these read the single `entry.allowance` / single `PlanInfo` and therefore carry Flash's wrong cap:

- `oc-cmd-compare/src/view/columns/od.ts:11-16` `od-allow` → `fmtAllowance` (`view/text/format.ts:27-30`): prints `$440` today, should be `$240`.
- `oc-cmd-compare/src/view/columns/od.ts:17-41` `od-req5h`, `od-reqwk`, `od-reqmo`: all three scale with the inflated `requestsPerMonth`; `od-req5h` also uses the plan's `$18` instead of Flash's `$10`.
- `oc-cmd-compare/src/view/columns/od.ts:42-47` `od-per1k` → `fmtPerThousand` (`view/text/format.ts:33-36`) over `payPerRequest = plan.price * cost / allowance` (`cli/engine/index.ts:35`): Flash reads `$0.0089`, should be `$0.0163` — a cheaper-looking model.
- `oc-cmd-compare/src/view/columns/od.ts:48-54` `od-reqdollar` → `fmtPerDollar` (`view/text/format.ts:39-43`) is `1/payPerRequest`: inflated in the opposite direction.
- `oc-cmd-compare/src/cli/engine/score.ts:29-38,53-61,82-97` — `assignIndex` (COST) and `assignValueIndex` (VAL) build one volume scale from `log10(requestsPerMonth)` across *all* rows. Inflating Flash moves every row's min-max position, so COST and VAL are contaminated beyond the OD column. In the probe above Flash gets `index 0` and Eco `index 100` purely from the shared-pool request counts.
- `oc-cmd-compare/src/view/footer.ts:24-43` `planBlock()` prints OD as `$10/mo · $220 combined credits · 5h $18 / wk $55` — the Eco set presented as the whole plan; `windowPercents()` at 45-54 prints `8% / 25%` from the same numbers.
- `oc-cmd-compare/src/view/footer.ts:103-108` `od source` line states `allowance = credits ÷ model multiplier` with no per-model-cap caveat, which is the assumption itself, printed as documentation.
- `oc-cmd-compare/src/view/render.ts:47-62` and `cli/run.ts:106-110` serialize exactly one `plans.od` object (`PlanInfo` at `src/types.ts:40-50`: one `credits`, one `fiveHour`, one `weekly`), so the JSON has nowhere to express a per-model cap today.
- `oc-cmd-compare/src/cli/flow/check.ts:31-39` — `--check --od-plan` prints only entry counts, `excluded`, `missing`, `only in OpenDesign`; it never checks caps or allowance. It is a blind spot, not a wrong figure: `test/data/od.test.ts:22-34` pins `$220/$55/$18` as "match the live pricing page", so the test suite would keep passing with Flash's cap wrong.

## 5. Smallest change, and the ripple

**Smallest local change (all inside `oc-cmd-compare/src/data/sources/od/`):**

1. `models.ts:1-12` — add an optional per-model cap to `OdModel`, e.g. `cap?: { credits: number; fiveHour: number | null; weekly: number }`, and set it on the one affected row: `DeepSeek V4.1 Flash → { credits: 120, fiveHour: 10, weekly: 30 }`. Eco and the rest keep the plan default. The published figures already exist as canonical data in `core/od.json:25-34` (`capOverrides`), but mpc ships standalone to npm, so importing `../../core/od.json` at runtime would break the published tarball — mirror the two rows locally and note the coupling in `oc-cmd-compare/AGENTS.md`.
2. `index.ts:35-42` — `allowanceOf` picks `model.cap?.credits ?? planDef(planId).credits` as the pool. If the top tier is ever given a cap, apply the same to `def.top`.
3. `index.ts:50-76` — attach the chosen cap to each `CatalogEntry` (a single optional field, e.g. `cap?: { credits, fiveHour, weekly }`), so `buildMetrics` can derive its windows per row.
4. `cli/engine/index.ts:23,33-34` — for OD rows take `windowRatios` from that per-entry cap (five `10/120`, week `30/120` for Flash) rather than the plan-wide `plan.fiveHour / plan.credits`; `allowance` already comes from the corrected `entry.allowance`. Leave the `config.window` override path intact.
5. `test/data/od.test.ts:41-58,89-108` — replace the loose `eco > flash` assertion with exact caps (Flash 240 / 615,384.62 / 51,282.05 / 153,846.15, Eco 814.81 / 2,089,268.76 / 170,940.17 / 522,317.19 at the default workload) and pin the window ratios. Cosmetic follow-up: `footer.ts:103-108` should stop claiming a single `credits ÷ multiplier` rule.

**Ripple:**

- `cmduse plans --json`: **none**. mpc never reads it for OD (`cli/flow/collect.ts:33-34` builds the OD side from local constants only). The other lane added cap data to `oduse plans --json`, a different binary and a different shape; mpc is not obliged to consume it, and consuming it would add a new runtime spawn that CI's hermetic tests cannot satisfy.
- Sidebar mpc spawn: **none**. `opencode-plugin/src/sidebar/data.ts:176-178` `metaArgs()` is `--json --shape off --oc-plan <plan>` — no `--od-plan`, so the sidebar never sees `rows[].od`; it gets OpenDesign from `odArgs()` at 187-189 (`oduse -1 --json --plan`). `rows[]` keeps the same keys, only the values change, so the plugin's `rows[]` contract and reqshape's null guard are untouched.
- Cross-file scope: `cli/engine/index.ts` is shared by OC/CC/OD, so step 4 must stay gated on `entry.provider === "od"`; a plan-wide change there would corrupt the other two sides' 20%/50% and derived windows.

**Separate blocker, reported not fixed:** the brief's verification command is currently unusable because of the Go-docs scrape drift described in the Method note. Restore the `role="tab"`/`tabpanel` parse against the redirected `/docs/console/go/` page before using `mpc --json --od-plan go` as the regression check; until then the pure-function probe above is the evidence.

**Verdict:** the single-pool assumption is real and isolated to Flash on Go; Eco is correct only because the plan's defaults happen to be the Eco set. One model row plus one window-ratio path is the fix; no JSON contract moves.
