# Lane A — re-source every OpenDesign rate from the published price list

## What changed

- Read the brief and both reference files. The published list has 46 models; 14 were already in `core/od.json` and 32 were not.
- Rebuilt `core/od.json` from the verbatim payload: all 46 rows carry published `input`/`output`/`cacheRead`, `cacheWrite` where published (24 rows), `longContext` where published (9 rows), and `rateSource: "published"`. Extracted date stamped `2026-11-17` (the payload's fetch date); `source` and `notes` now name `https://amr-api.open-design.ai/api/v1/public/model-prices` and the raw file instead of `core/zen.json`. Multipliers untouched on the original 14; the 32 new rows use `1` because `od-caps.json` publishes no multiplier for them.
- `cmduse/src/oduse/od.rs`: added `cache_read`, `cache_write`, `long_context` to `Model`; `turn_cost` compares the store's fresh `input` counter to `inputTokensAbove` (cache reads are disjoint) and reprices the whole turn. `price()`/`credits()` stay flat because they take no token count.
- `cmduse/src/oduse/price.rs`: removed `zen_cache_read`; `cache_read_rate(published, input)` takes the published rate and falls back to the row's own input rate, flagged.
- Tests rewritten for published figures; new `tests/published_rates.rs` pins all 46 rows, the payload-only ids and tier behaviour. `od_wire.rs` updated for the 46-row table and Haiku's tier.
- Plugin `catalogOpenDesign.ts` filter accepts `published`; its test updated (Eco and `hy4-flash` now priced).
- `cmduse/README.md` and `cmduse/cmduse.1` updated for the new rate source, cache handling and long-context tiers.

## Reconciliation against the account

Measured on this machine with `-1 --no-wallet --json`, weekly `totals`:

| | `credits` (dollars of allowance) | `costUsd` (list price) | requests |
|---|---|---|---|
| Before (installed `oduse`) | 5.681 | 11.686 | 8,725 |
| After (rebuilt `odusedev`) | 11.110 | 22.323 | 8,780 |
| Server `billing/snapshot` | 12.14 (121,442 raw credits at $0.0001) | — | — |

The brief's stated before figure was $5.11; the same run read 5.681 at measurement time. The comparable column is `credits`, because the server's raw credits already carry the model multipliers. The gap to the server closed from ~$7.03 to ~$1.03 (85%). `costUsd` roughly doubled because DeepSeek's flat rate doubled from the off-peak seed to the published peak rate; it is list price before the 0.5 multiplier, so it is not the figure to compare against the server's credits. The remaining ~$1.03 is the expected local/server difference: the server prices long-context turns and gateway-side models the local store cannot reconstruct exactly.

## Gate

- `cargo test` — green (327 passed, 0 failed).
- `cargo fmt --all -- --check` — green.
- `cargo clippy --all-targets -- -D warnings` — green.
- `cd opencode-plugin && bun test` — green (329 pass, 0 fail); `bun check` — green (80 files).
- `bun fmt --check` on edited JSON/TS — green.
- Two transient failures during the run (statusline shared-key assertions in `report_render.rs`, then `sidebar-ark.test.ts` / `sidebar-session.test.ts`) came from sibling lanes editing those files mid-run; both passed on re-run after their edits landed. Nothing in those files was reverted or edited here.

## Follow-up closed (second pass)

- `cmduse/src/oduse/render/catalog.rs`: the `RATE` column no longer uses a two-way `== "repo"` check. `rate_label(Option<&str>)` maps exactly `Some("published")` to `published`, `Some("estimate")` to `estimate`, and everything else to `—`. `oduse models` now prints `published` on all 46 rows.
- `cmduse/src/oduse/tests/render_catalog.rs`: replaced the assertion that some row says `estimate` with a check that all 46 rate rows say `published`, plus `a_published_rate_renders_as_published` pinning the Flash row and the JSON `rateSource` value.

### Sweep of `rg -n 'rateSource|"repo"|"estimate"' cmduse/src opencode-plugin/src core/`

| Site | Was | Now |
|---|---|---|
| `cmduse/src/oduse/render/catalog.rs:78` | `rate_source == "repo"` chose the label | exact `rate_label`; only `published` prints published |
| `cmduse/src/oduse/tests/render_catalog.rs:13` | asserted an `estimate` row exists | asserts every rate row is `published`; new explicit published-row test |
| `cmduse/src/oduse/tests/od.rs`, `tests/published_rates.rs` | compared `String` to `"published"` | compare `Option<String>::as_deref()` to `Some("published")` |
| `cmduse/src/oduse/od.rs` | `rate_source: String`, required | `Option<String>`, `#[serde(default)]`, so a missing label parses as `None` |
| `cmduse/src/oduse/render/catalog_json.rs` | emitted a plain string | emits the `Option` verbatim: `"published"` today, `null` when absent |
| `opencode-plugin/src/catalogOpenDesign.ts:58` | already exact `=== "published"` | unchanged; still the only authoritative path to `odCost` |
| `core/src/lib.rs:370` | schema marker `OD_JSON.contains("\"rateSource\"")` | unchanged; not a value comparison |
| 46 rows in `core/od.json` | all `rateSource: "published"` | unchanged; provenance note now describes all three cases |

No `"repo"` value comparison remains. The three surviving `"repo"` strings are test-only: one pins that an old value renders as `—`, two are comments. `estimate` survives only as a distinct label and as a test fixture for that label.

### Three-case semantics

`core/od.json` notes now state it explicitly: `published` = rates from Open Design's own price list (the only authoritative case); `estimate` = seeded stand-in where no rate is published (none today); absent field = no provenance claim. A row with no `rateSource` parses as `None` (`a_row_with_no_rate_source_carries_no_provenance_claim`) and renders as `—`, never as published. A unit test in `render/catalog.rs` pins all four label outcomes, including an old `"repo"` value falling to `—`.

### Gate (second pass)

`cargo test` 330 pass / 0 fail; `cargo fmt --all -- --check` green; `cargo clippy --all-targets -- -D warnings` green; plugin `bun test` 329 pass / 0 fail and `bun check` clean; `bun fmt --check core/od.json` green. `oduse models --no-wallet` verified: `deepseek-v4.1-flash … published`.

## Footer and prose sweep (third pass)

- `render/dash.rs:148`: the footer no longer claims cache rates come from `core/zen.json` or that every figure is an estimate. It now reads:
  `credits = list-price $ x the model's multiplier; cache reads priced from Open Design's published model-prices list. Only a rate with no published source is an estimate, and any turn priced that way is counted below.`
  The existing conditional line still reports `N of M turns price cache reads at the model's input rate; no published cache rate for that model`, driven by `window/totals.rs::cache_estimated`, so an unlabelled future row is named rather than folded into a blanket estimate.
- `tests/render.rs`: replaced the `cache reads included` / `these are estimates` assertion with the real source sentence and a negative check that published rows are not called estimates.
- `render/catalog.rs` doc: the RATE column is now described as published / estimate / unlabelled.
- `od.rs::catalogId` doc: no longer claims the provenance lookup uses it; it is a legacy Go/Zen spelling kept for readers and `--json`.
- `cmduse.1` oduse data section: replaced "the store's usage events carry no cache tokens, which understates a cache-heavy turn: that is the same estimate" with the real split (app store has no cache counters, `opencode.db` does, cache priced from the published list, inferred cache rate counted on the footer).
- `rg -n 'zen\.json|repo|estimate' cmduse/src/oduse cmduse/README.md cmduse/cmduse.1` leaves only accurate negative statements (`never taken from core/zen.json`, `core/zen.json is no longer consulted`), the three-case label prose, local-window estimates, and the `cache_estimated` flag/tests. The two `core/zen.json` mentions outside oduse are the ocuse section.

Verified: `cargo build -p cmd-usage && ./target/debug/oduse -1 --no-wallet | tail -4` printed the new footer. Gates re-run green: `cargo test` 330, fmt check, clippy `-D warnings`.
