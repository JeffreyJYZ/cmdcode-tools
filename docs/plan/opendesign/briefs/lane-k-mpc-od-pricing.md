# Lane K — `mpc` prices OpenDesign with the wrong table

## The defect, measured

```
$ cd oc-cmd-compare && bunx mpc --od-plan go --json --shape off --model 'DeepSeek V4.1 Flash'
od  {"pricing":{"input":0.15,"output":0.6,"cacheRead":0.003,"cacheWrite":null},"allowance":120}
```

```
$ rg -n '"id": "deepseek-v4.1-flash"' -A6 core/od.json
"input": 0.3, "output": 1.2, "cacheRead": 0.006, "rateSource": "published"
```

The OpenDesign column is priced at **half** the published rate, because `oc-cmd-compare` never reads `core/od.json`. Its loader says so out loud:

`oc-cmd-compare/src/data/sources/od/index.ts:16-24` — `pricedKeys()` builds its map from `[...priced.cc, ...priced["oc-go"]]`, and the doc comment at :82-87 justifies it with "OpenDesign publishes credit multipliers and estimated request counts, not per-model token rates."

**That sentence is no longer true.** OpenDesign publishes a full price list at `GET https://amr-api.open-design.ai/api/v1/public/model-prices`, and this repo already carries it verbatim at `docs/plan/opendesign/reference/od-model-prices.json`, already reconciled into `core/od.json` by lane A (46 rows, every one `rateSource: "published"`, verified 0 mismatches against the raw payload).

So `mpc` understates OpenDesign cost per request by 2× for the very model the user runs, which inflates `requestsPerMonth` by 2× — `53.8K` where the honest figure is about half. A comparison tool that is wrong about one of its three columns is worse than one that omits it.

## What to change

1. **Read the real rates.** `core/od.json` is the same repo, already imported at build time by other packages (`opencode-plugin` imports `core/{gating,conformance}.json` directly). Wire the OpenDesign source's pricing to `core/od.json`'s model rows instead of `pricedKeys(priced)`:
   - key by the model's own id (the wire id, which is what `core/od.json` is keyed by);
   - carry `input`, `output`, `cacheRead` (and `cacheWrite` where published);
   - keep `null` for a model the list does not carry rather than falling back to a foreign catalogue's rate — a made-up rate is the defect, and the existing `missing`/`uncapped` reporting machinery already exists to say so.
2. **Keep the multiplier honest.** `core/od.json` publishes the multiplier per model (`0.5` Flash, `0.27` Eco, `1` for most). The current code derives one (it prints `12` for Flash, which is not a published figure at all). Use the published multiplier where a row has one; say in a comment which value a plan-without-a-row falls back to and why.
3. **Keep the CC/OC catalogue as a fallback only**, and only where `core/od.json` genuinely has no row — flagged the same way `missing` flags it today. Do not silently cross-price.
4. **Check every consumer.** `rg -n 'loadOdCatalog|OD_MODELS|priceKey|pricedKeys' oc-cmd-compare/src` — `priceKey` exists to repoint a model at a different row (it currently points the labelled DeepSeek at `deepseekv41flash`); with real rates the indirection may still be needed for ids that differ, so keep it where it earns its place and delete it where it does not. Explain each survivor.
5. **Tests.** `oc-cmd-compare` has its own suite: an OpenDesign row's `pricing` must equal `core/od.json`'s row for the same id, a model absent from the list must render unpriced (not cross-priced), and the published multiplier must be the one used. A test that asserts against a literal is fine only if the literal is quoted from `core/od.json` in the same test.

## Verify by running it

```
cd oc-cmd-compare && bunx mpc --od-plan go --json --shape off --model 'DeepSeek V4.1 Flash'
```

must report `input 0.3, output 1.2, cacheRead 0.006, cacheWrite null`, and the resulting `requestsPerMonth` must be **half** the current `307692` (~`153846`). Paste the before and after JSON in your report.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `oc-cmd-compare/src/**` and `oc-cmd-compare/test/**`. **Do not touch** `core/od.json` (it is correct — read it, do not edit it), `cmduse/**`, or `opencode-plugin/**` — sibling lanes own those and `core/od.json` is the source of truth this lane consumes.
- Gate before you report: `cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint`, plus the real `mpc` run above. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-k-mpc-od-pricing.md`. Final chat reply under 15 lines: the before/after pricing JSON, what fell back and what did not, the gate result.
