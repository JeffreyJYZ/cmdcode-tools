# Lane A — re-source every OpenDesign rate from the published price list

## Why this exists

`core/od.json` prices OpenDesign turns from rates seeded secondhand out of `core/zen.json`. OpenDesign now publishes its own authoritative list, and the seeding is wrong: `oduse` reports `$5.11` of weekly spend where the account's own `billing/snapshot` says `$12.14`. Seven of the fourteen rows disagree with the published list, and cache reads — 99% of the token mass — are priced off a different table entirely.

## The authoritative source

`docs/plan/opendesign/reference/od-model-prices.json` — verbatim `GET https://amr-api.open-design.ai/api/v1/public/model-prices`, envelope `{"data":[...]}`, 46 models. Per row: `model`, `pricing{unit:"1m_tokens", currency:"USD", input, output, cacheRead, cacheWrite?, longContext?}`, where `longContext` carries `inputTokensAbove` plus its own `input`/`output`/`cacheRead`/`cacheWrite`.

`docs/plan/opendesign/reports/od-model-prices.md` already carries the full published-vs-current diff, the long-context tiers, the 32 payload-only ids and the provenance verdict. Read it first; do not re-derive it.

## What to change

1. **`core/od.json` — every one of the 14 model rows** takes `input`, `output` from the published row, plus a new `cacheRead` field (and `cacheWrite` where published). Add `"rateSource": "published"` and stamp provenance: bump `extractedAt`, and extend `source` / `notes` to say the token rates now come from `https://amr-api.open-design.ai/api/v1/public/model-prices` with the fetch date, not from `core/zen.json`. `multiplier` does not change — the price list publishes no multiplier, so it stays as it is.
2. **Long-context tiers.** `claude-haiku-5.5` (`@100000`) and `gpt-6-luna` (`@272000`) carry one. Model it in `core/od.json` (e.g. `longContext: {inputTokensAbove, input, output, cacheRead, cacheWrite}`) and apply it in `cmduse/src/oduse/od.rs::turn_cost` when the turn's input exceeds the threshold. A model with no `longContext` keeps the flat rate. State in a comment which counter the threshold is compared against — the store's `input` is the fresh counter and `cache_read` is disjoint, so pick one and say why.
3. **`cmduse/src/oduse/price.rs` — drop `zen_cache_read` as the cache source.** A published `cacheRead` always wins. Keep the fallback for a model the list does not carry (32 of them are unpriced today), but the fallback must now prefer the row's own `input` rate and stay flagged `cache_estimated`. The `zen_cache_read` doc comment currently explains a Go-vs-Zen floor; rewrite it to say what the code now does, or delete the function if nothing else needs it.
4. **Add the priced payload-only ids that a real lane can hit.** `hy4-flash`, `hy4`, `kimi-k3`, `kimi-k3.1-pro` and the `claude-*`/`gpt-*`/`gemini-*`/`grok-*`/`muse-*`/`qwen*` ids — add a row per id with its published rates, `multiplier: 1` unless `docs/plan/opendesign/reference/od-caps.json` publishes one for it, and `rateSource: "published"`. Do not invent a multiplier; where the caps reference has none, use 1 and note it in the same note array. Skip nothing the price list carries — an unpriced turn reported as unpriced is the defect this brief exists to remove.
5. **Fix every test that asserts an old figure.** `cmduse/src/oduse/tests/od.rs` pins `(0.15, 0.6)` for Flash and minimax and asserts `rateSource == "repo"`; `tests/window.rs` and `tests/price.rs` pin figures derived from the old rates; `opencode-plugin/src/catalogOpenDesign.ts` filters on `rateSource === "repo"`, so a published row must stay eligible for the plugin's price table (check `catalog.test.ts` / `catalogOpenDesign.test.ts` and update the filter to accept `published`). Recompute each expected number from the published rate rather than nudging it to whatever the test says — say in a comment which rate produced it.
6. **Reconcile against the account.** After the change, `oduse -1 --no-wallet --json` on this machine must report a `summary.costUsd`/credits figure in the same range as the server's `$12.14` weekly (`121,442` credits), not `$5.11`. Run it and paste both numbers in your report. The remaining gap (server slightly higher than a local recompute) is expected — the server prices long-context turns and models, which is exactly what items 2 and 4 are for; say how much of the gap your change closed.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode.
- Never use `agent-desktop`, and never move the user's cursor.
- Do not edit `opencode-plugin/src/index.ts`, `v2.ts`, `cli.ts`, `tui-commands.tsx`, `constants/providers.ts` or `test/plugin.test.ts` — a sibling owns those this round.
- Your files: `core/od.json`, `cmduse/src/oduse/od.rs`, `price.rs`, `cmduse/src/oduse/tests/*`, `cmduse/README.md`, `cmduse/cmduse.1`, and `opencode-plugin/src/catalogOpenDesign.ts` plus its tests.
- Gate before you report: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and `cd opencode-plugin && bun test && bun check`. A red gate is not a finished lane.
- Documentation moves with the code: update `cmduse/README.md` and `cmduse/cmduse.1` for any user-visible change.

## Report

Append to `docs/plan/opendesign/reports/lane-a-od-rates.md` as you go, and keep your final chat reply under 15 lines: what changed, the gate result, the before/after weekly figure, and anything you could not do.
