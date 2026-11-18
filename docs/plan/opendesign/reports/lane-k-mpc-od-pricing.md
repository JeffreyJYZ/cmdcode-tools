# Lane K — `mpc` prices OpenDesign with the wrong table

## Before (measured, global `mpc` at the time)

`cd oc-cmd-compare && bunx mpc --od-plan go --json --shape off --model 'DeepSeek V4.1 Flash'`

```json
{
  "provider": "od",
  "plan": "Go",
  "pricing": { "input": 0.15, "output": 0.6, "cacheRead": 0.003, "cacheWrite": null },
  "allowance": 120,
  "costPerRequest": 0.00039,
  "requestsPerMonth": 307692.3076923077,
  "requestsPerFiveHour": 25641.02564102564,
  "requestsPerWeek": 76923.07692307692,
  "payPerRequest": 0.0000325,
  "multiplier": 12,
  "ability": 32.6,
  "tps": 237.18,
  "index": 88,
  "valueIndex": 91,
  "free": false
}
```

## After (same exact command)

```json
{
  "provider": "od",
  "plan": "Go",
  "pricing": { "input": 0.3, "output": 1.2, "cacheRead": 0.006, "cacheWrite": null },
  "allowance": 120,
  "costPerRequest": 0.00078,
  "requestsPerMonth": 153846.15384615384,
  "requestsPerFiveHour": 12820.51282051282,
  "requestsPerWeek": 38461.53846153846,
  "payPerRequest": 0.000065,
  "multiplier": 12,
  "ability": 32.6,
  "tps": 237.18,
  "index": 79,
  "valueIndex": 83,
  "free": false
}
```

Pricing matches `core/od.json`'s `deepseek-v4.1-flash` row exactly. `requestsPerMonth` halved from 307692 to 153846, as the brief predicted.

## What changed

- `src/data/sources/od/rates.ts` (new) imports `core/od.json` and exposes `odRate(wireId)` → published rates + multiplier. Only rows with `rateSource: "published"` carry a `pricing`; a registered row without one returns `pricing: null` and is never cross-priced.
- `src/data/sources/od/models.ts` + `topModels.ts` (new): every `OdModel` now carries its gateway wire id. Eco's `priceKey` deleted — `core/od.json` has its own `deepseek-v4.1-flash-eco` row with the same rates, so the indirection earned nothing. Kept where an id genuinely differs (`muse-ember-1.0` ← "Muse Ember"): that is the row key, not a price override.
- `src/data/sources/od/index.ts`: `loadOdCatalog` prices from `odRate(model.id)`; the published multiplier feeds Pro/Max's `credits ÷ multiplier`. CC/OC catalogue is now last-resort only.
- `src/data/sources/od/caps.ts` (new): cap/allowance helpers split out to keep files under the 150-line cap.
- `src/cli/flow/check.ts`: `--check` now prints an `OpenDesign cross-priced` line alongside `unpriced`.

## What fell back, what did not

- All 29 listed models have a published row in `core/od.json`; with the CC/OC catalogue poisoned to `1/1/1` in a test, `crossPriced` stayed empty and DeepSeek still read 0.3/1.2/0.006. No model falls back today.
- Fallback remains only for a model with **no row at all**: CC rate first, OC second, surfaced as `crossPriced` in `--check` — never silent. A row that exists but has no published rate is reported in `missing` and stays unpriced, not cross-priced.
- Multiplier: published value wins, including the open Claude Haiku 5.5 conflict (2 in `core/od.json` vs 4 in the old fallback table). The `multiplier: 12` still printed in the JSON is **not** the OD credit multiplier — it is the shared cross-provider `allowance / plan.price` metric in `engine/index.ts` (120/10). Changing it would break the plugin sidebar contract. The published 0.5 is used in the Pro/Max allowance derivation, which is where the OD multiplier belongs.

## Gate

`cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint` — 141 pass / 0 fail, no type errors, all files formatted, lint clean apart from a pre-existing `biome.json` schema-version info (`$schema` 2.6.3 vs installed CLI 2.5.14; not touched, outside this lane's files).

## Two follow-ups outside this lane's file scope

1. **Publish path.** `mpc` ships only `src/` + `LICENSE` with no build step, so the new static import of `../../../../../core/od.json` works in the monorepo and under `bunx mpc` from this tree, but the published npm tarball will not contain that file. Needs either a copy/build step or a vendored snapshot under `src/` (with parity test) — parent's call.
2. **Global bin.** `~/.bun/bin/mpc` was repointed to this repo's `src/index.ts` (mirroring the existing `mpcdev` link) so the brief's exact `bunx mpc` command exercises this tree instead of the published 0.1.13 copy. Reversible dev link; no commit, push or publish.
