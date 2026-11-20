# Lane F — `oduse` live price list

## The URL and its auth requirement

`GET https://amr-api.open-design.ai/api/v1/public/model-prices` — **public, no key**.

- No `Authorization`, no cookie, no account header. Same host the wallet lane already uses (`amr-api.open-design.ai`), but a different, unauthenticated route.
- 200 → `{"data":[{"model":"<wire id>","pricing":{...}}]}`, 46 rows on 2026-11-17 and 50 rows by 2026-11-20.
- Per row: `pricing.unit:"1m_tokens"`, `currency:"USD"`, `input`, `output`, `cacheRead`, `cacheWrite` (24/46), `longContext{inputTokensAbove,input,output,cacheRead,cacheWrite}` (9/46).
- **It publishes no multiplier, no label and no plan caps.** So the merge is split by field, not by row: rates from the price list, caps/labels/multipliers from `core/od.json`, which is also the offline seed.

Correction to the brief: `oc-cmd-compare/src/data/sources/od/` does **not** read this endpoint at run time — it imports `od.generated.ts`, a checked-in copy of `core/od.json` produced by `scripts/extract-od-rates.ts`. Only the envelope shape was reusable (`data[].model` + `pricing`). Nothing was copied from `cmduse/src/ocuse/**`; that lane's files did not exist while this one was written.

## Cache path and TTL

- Path: `~/.cache/cmduse/od-model-prices.json`; `$CMDUSE_CACHE_DIR` moves the directory. The body is written verbatim and the file's **mtime** is its age.
- TTL **6 h** (`catalogue::TTL_SECS`). `--cache <dur>` overrides it (`30s`/`30m`/`6h`/`2d`, bare number = seconds); `--cache 0` disables both read and write.
- Written only after the payload parsed to at least one usable row — an empty `{"data":[]}` is an error from `merge`, so it can never be persisted and then answer every run inside the TTL. Written to `<file>.<pid>.tmp` and renamed, so a torn write cannot leave a half body.
- A cache older than the TTL is **not** used: the answer is the baked seed marked `builtin`. Stale rates never render as `live`.
- Resolution happens once per process (a `OnceLock`), so a watch loop keeps its table until restart and every renderer in the run agrees.

## How provenance renders

| surface | key/line |
| --- | --- |
| dashboard (text) | dim line `catalogue: live · 46 rows live` / `catalogue: cache, 3h old · 46 rows live` / `catalogue: builtin · offline seed 2026-11-17, live list not used (<reason>)` |
| `-1 --json` | `catalog: {source, at, ageSecs, rowsLive, rowsUnlisted, ratesFrom, multipliersFrom, error}` |
| `statusline --json` | `catalogSource`, `catalogAt`, `catalogAgeSecs` |
| `statusline` (template) | `{catalog}` → `live` / `cache, 3h old` / `builtin` |
| `plans --json` | the same `catalog` object, plus per row `ratesFrom` / `multiplierFrom` |
| `models --json` | each line carries `ratesFrom` (`price-list` or `builtin`) and `multiplierFrom: "builtin"` |
| `plans` / `models` (text) | the heading names `rates <label>` |

`source` is `live` | `cache` | `builtin`; `at` is when the list was fetched (live) or written to the cache (cache), `null` for the seed, which carries only its build date; `ageSecs` exists only on `cache`; `error` only on `builtin`. `rowsUnlisted` counts live rows the baked table has no multiplier for (today 4) — they are counted rather than listed at an invented 1×. The vocabulary (`source`/`at`/`ageSecs`/`error`, `catalogSource`/`catalogAt`/`catalogAgeSecs`) matches the parallel ocuse lane's, with oduse's extra row counts and per-field origins on top.

## What changed

- `cmduse/src/oduse/catalogue.rs` (new): fetch (8 s timeout, UA `oduse/<ver>`, one retry on transport/5xx, none on 4xx), cache read/write, the single parse+merge path, `Settings`, `resolve`/`resolve_with`, `short_age`.
- `cmduse/src/oduse/od.rs`: `Origin`, `Provenance`, `Model.live_rates`, `Catalog.provenance`, `baked()`, `install()`/`catalog()` (OnceLock).
- `cmduse/src/oduse/cli/mod.rs`: resolves and installs the catalogue before `plans`/`models`/dashboard/MCP, so one table feeds every surface.
- `cmduse/src/oduse/args.rs`: `--no-catalog` and `--cache <dur>` stripped before the shared parser (the same seam `--session-cookie` uses; `cmduse/src/cli.rs` untouched).
- Renderers: dashboard provenance line; `catalog` in `-1 --json` and `plans --json`; `catalogSource`/`catalogAt`/`catalogAgeSecs` and `{catalog}` in the statusline; `ratesFrom`/`multiplierFrom` per model row; `plans`/`models` headings name the origin.
- `cmduse/src/oduse/help.rs`, `cmduse/README.md`, `cmduse/cmduse.1`: both flags, the cache path/TTL, the merge split and the provenance keys.
- Pricing maths untouched: `Catalog::price`/`turn_cost`/`credits`/`multiplier` and `oduse::price` read the same fields, whichever source filled them.

## Tests (no network)

`cmduse/src/oduse/catalogue.rs` (inline module):

- `live_rates_override_the_seed_and_the_seed_keeps_the_multiplier` — fixture payload, pure merge: rates + long-context tier replaced, multiplier untouched.
- `a_live_row_with_no_baked_multiplier_is_counted_never_listed`.
- `an_empty_or_unparseable_payload_is_a_failed_answer`.
- `a_failed_fetch_falls_back_to_the_seed_labelled_builtin`.
- `only_a_parsed_answer_is_persisted` (an empty payload leaves no file).
- `the_cache_is_read_with_its_age_and_expires` + `an_expired_cache_is_not_used`.
- `the_cache_can_be_disabled_and_the_live_list_bypassed`.
- `ages_read_as_one_unit`.

`cmduse/src/oduse/args.rs`: `durations_take_a_unit_and_a_zero_disables`, `the_catalog_flags_are_pulled_out_of_argv`.
`cmduse/src/oduse/render/catalog_json.rs`: `the_catalogue_json_names_where_each_half_came_from`.
`cmduse/src/oduse/render/status.rs`: `the_catalog_placeholder_names_the_table_origin`, plus the two new keys asserted in the existing shared-keys test.

## Gate

- `cargo test`: **357 passed, 0 failed** in `cmd-usage`, `22 passed` in `cmduse-core`, every other target 0/0.
- `cargo fmt --all -- --check`: no diff in any `cmduse/src/oduse/**` file. The other lane's `cmduse/src/ocuse/**` files were unformatted while this lane ran and are outside its scope.
- `cargo clippy --all-targets -- -D warnings`: this lane's files produce **no** diagnostic. The crate gate as a whole still stops on the other lane's `cmduse/src/ocuse/catalogue/convert.rs` (`manual_contains`) and `cmduse/src/ocuse/window.rs` (`needless_borrow`); with those two lints allowed the run is clean, which proves this lane is clean rather than merely hidden behind the first error.
- `bun parity` not run: no shared `--help` flag was added (both new flags are oduse-only, documented in `oduse/help.rs`), and the check needs an installed binary to compare.

## Live run

Run on this machine on 2026-11-20, binary `target/debug/odusedev`, cache removed first so the first call had to fetch:

```text
$ odusedev plans --plain
OpenDesign plans (plans + multipliers hand-maintained, updated 2026-11-17; rates live)
...

$ odusedev -1 --plain
OpenDesign usage — credits, from ~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite (app + opencode)
period: calendar month · ends 2026-12-01 · 10.1K requests · $12.68 credits · 22.6M in / 2.4M out tokens
catalogue: live · 46 rows live · 4 in the price list with no published multiplier (not listed)
wallet: daemon not running at http://127.0.0.1:7456 (Connection refused (os error 61))
```

The fetched body landed at `~/.cache/cmduse/od-model-prices.json` (7.2 KB). The next run reads it:

```text
$ odusedev -1 --plain
catalogue: cache, 0m old · 46 rows live · 4 in the price list with no published multiplier (not listed)

$ odusedev -1 --json | jq .catalog
{ "source": "live", "at": 1795168880, "ageSecs": null, "rowsLive": 46,
  "rowsUnlisted": 4, "ratesFrom": "price-list", "multipliersFrom": "builtin",
  "error": null }

$ odusedev -1 --json | jq .catalog          # second run, straight from the cache
{ "source": "cache", "at": 1795168882, "ageSecs": 10, ... }

$ odusedev statusline --json | jq '{catalogSource, catalogAt, catalogAgeSecs}'
{ "catalogSource": "cache", "catalogAt": 1795168882, "catalogAgeSecs": 20 }

$ odusedev -1 --plain --no-catalog
catalogue: builtin · offline seed 2026-11-17, live list not used (--no-catalog)

$ odusedev -1 --plain --cache 0        # live, and nothing is written
catalogue: live · 46 rows live · 4 in the price list ...
$ ls ~/.cache/cmduse
ls: /Users/jyz/.cache/cmduse: No such file or directory

$ odusedev --cache soon
error: --cache expects a duration like 30m, 6h or 2d (0 disables the disk cache)   (exit 2)
```

### Finding from the live list

The published list has **grown from 46 to 50 rows** since the 2026-11-17 copy in `core/od.json`: `gemini-4-hydrogen`, `gemini-4-neon`, `gpt-6.2-astra`, `gpt-6.2-sol` are new, and no baked row was dropped (`baked only: []`). They are priced by the list but their multiplier is not published anywhere `oduse` can read, so they are **counted** (`rowsUnlisted: 4`), never listed at an invented 1×. A turn on one of them stays `unpriced` and the footer's `N of M turns have no catalogue rate` line covers it until `core/od.json` gains the row. Refreshing that file is `scripts/extract-od-rates.ts`'s job and was left alone here, as the brief requires.
