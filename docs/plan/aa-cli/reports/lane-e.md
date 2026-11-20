# Lane E report — `ocuse` fetches the Go catalogue live

Status: done. Gates green on the whole crate (`cargo test` 357 passed, `cargo fmt --all -- --check`,
`cargo clippy --all-targets -- -D warnings`). One repo gate I do not own stays red — `bun parity`, see
"Follow-ups".

## What the user sees

**Flag:** `--no-catalog` forces the baked `core/zen.json`; `--cache <dur>` sets the catalogue cache TTL
(`0` off, `30s`, `15m`, `6h` default, `1d`, or a bare count of seconds). Both are documented in
`ocuse --help` (printed from `ocuse/cli.rs`, because `OCUSE_HELP` lives in the shared parser another lane
owns), in `cmduse/README.md` and in `cmduse/cmduse.1`.

**Cache:** `~/.cache/cmduse/ocuse-catalogue.json`, TTL **6 h** by default, `CMDUSE_CACHE_DIR` moves the
directory. Written temp-then-rename, and **only** after a parse that produced at least one plan with
per-model limits — an unusable payload, a body that will not parse, or an empty model list never reaches
disk (tested three ways). A file that exists but is older than the TTL, or whose content no longer parses,
is treated as a miss rather than trusted.

**Order:** a cache inside its TTL → a live fetch → the baked seed. A failed fetch falls back to the seed
(the brief's rule), not to a stale cache, so the fallback is always the file `extract-zen` generated.

**Provenance, everywhere:**

| surface | what it carries |
| --- | --- |
| dashboard | `catalogue: live · fetched 2026-11-20T10:03Z` / `catalogue: cache · written …, 10s old` / `catalogue: builtin · generated 2026-11-20T09:44Z · catalogue: HTTP 503` |
| `-1 --json` | `"catalog": {"source": "live"\|"cache"\|"builtin", "at": <epoch ms>, "ageSecs": 0, "error": null}` |
| `statusline --json` | `"catalogSource": "live"`, `"catalogAt": 1795168998473`, `"catalogAgeSecs": 0` |
| statusline template | `{catalog}` → the same phrase the dashboard prints |
| `plans` / `plans --json` | text header `(catalogue live · fetched …)`; JSON gains the same `catalog` object |
| `models` | header `(plan go · 27/31 granted · catalogue live)` |

## Live run (2026-11-20, cache removed first)

```sh
$ rm -f ~/.cache/cmduse/ocuse-catalogue.json
$ ./target/debug/ocuse -1 --no-api --plain
catalogue: live · fetched 2026-11-20T10:08Z
…
deepseek-v4.1-flash          LIMIT EXCEEDED $100.00     $65.65   65.7%    $3.05   $56.69   32.4K
glm-5.3                      $500.00      $0.36    0.1%    $0.36    $0.36       1

$ ./target/debug/ocuse -1 --no-api --plain        # second process
catalogue: cache · written 2026-11-20T10:08Z, 21s old

$ ./target/debug/ocuse -1 --no-api --plain --no-catalog
catalogue: builtin · generated 2026-11-20T09:44Z

$ ./target/debug/ocuse statusline --no-api --json   # cache removed first
…"catalogSource":"live","catalogAt":1795168943455,"catalogAgeSecs":0…

$ ./target/debug/ocuse -1 --no-api --json --no-catalog | jq .catalog
{ "ageSecs": 0, "at": 1795167886826, "error": null, "source": "builtin" }

$ ./target/debug/ocuse models --plan go | rg deepseek-v4.1-flash
DeepSeek V4.1 Flash 1017   deepseek-v4.1-flash   $0.15  $0.6  $0.003  $100.00  yes
$ ./target/debug/ocuse models --plan go-teams | rg deepseek-v4.1-flash
DeepSeek V4.1 Flash 1017   deepseek-v4.1-flash   $0.15  $0.6  $0.003  $105.00  yes
```

`--cache 0` never writes (`~/.cache/cmduse` stays absent) and never reads. A poisoned cache
(`{"object":"list","data":[]}` written by hand) is ignored and the next run fetches live again — done for
real, then the good file restored.

## Fixture

`cmduse/src/ocuse/catalogue/sample.json` — **5 models**, trimmed verbatim out of the live body:
`beam-free`, `deepseek-v4.1-flash`, `gemini-4-argon`, `glm-5.3-flash`, `gpt-6-luna`. Together they cover a
peak multiplier, context tiers, a cache-write TTL map, a `date` (reprice) multiplier that must be ignored,
and a free model with `monthly_usage: null`. Tests never touch the network: `resolve_with` takes the fetch
and the clock.

## Files

| file | lines | what |
| --- | --- | --- |
| `cmduse/src/ocuse/catalogue/mod.rs` | 146 | `Options`/`Loaded`, the `OnceLock` accessors, resolve order |
| `cmduse/src/ocuse/catalogue/provenance.rs` | 88 | `Source`, `Provenance` (label / describe / json / seed) |
| `cmduse/src/ocuse/catalogue/cache.rs` | 109 | cache path + `CMDUSE_CACHE_DIR`, TTL read, atomic write, `has_limits`, age/stamp |
| `cmduse/src/ocuse/catalogue/payload.rs` | 116 | the endpoint DTOs (only the fields this crate reads) |
| `cmduse/src/ocuse/catalogue/convert.rs` | 135 | payload → `Catalog`: model list, plan discovery, label/price from the seed |
| `cmduse/src/ocuse/catalogue/rates.rs` | 186 | rate variants: context tiers, peak sheet, cache-write TTL map, reprice multipliers skipped |
| `cmduse/src/ocuse/catalogue/fetch.rs` | 63 | ureq, 8 s timeout, one retry on a transport fault only, `User-Agent: ocuse/<ver> (cmduse)` |
| `cmduse/src/ocuse/catalogue/tests.rs` | 156 | conversion, rates, unknown-plan, provenance text (4 tests) |
| `cmduse/src/ocuse/catalogue/tests_cache.rs` | 131 | fallback, empty-never-cached, fresh/stale/poisoned cache, `--cache 0`, `--no-catalog` (7 tests) |
| `cmduse/src/ocuse/catalogue/sample.json` | 7 | the pinned payload (5 models) |
| `cmduse/src/ocuse/zen.rs` | 293 | `builtin()` = the seed parse; `catalog()` = the resolved one (`&'static`); the misleading comment replaced |
| `cmduse/src/ocuse/cli.rs` | 999 | flag lifting, `parse_duration`, `init` before the first read, help lines, 2 new tests |
| `cmduse/src/ocuse/render.rs` | 2763 | provenance line, `catalog` in the two JSON projections, `{catalog}`, plan/model headers |
| `cmduse/src/ocuse/{mod,window,mcp,db}.rs` | — | module registered; `&catalog()` sites adjusted for the reference return |
| `cmduse/src/report_render.rs` | 1 line | `STATUSLINE_EXTRA_KEYS` + `catalogSource`/`catalogAt`/`catalogAgeSecs` (shared file, see below) |
| `cmduse/README.md`, `cmduse/cmduse.1` | — | the live catalogue, both flags, cache path/TTL, `catalog`/statusline keys, `{catalog}` |
| `docs/agents/aa-e.md` | — | lane notes (decisions, traps) |

`ocuse plans` no longer says "both plans": it lists **every** plan the endpoint publishes (`go`, `go-plus`,
`go-teams` today), and a plan the seed has no price for prints `price unknown` instead of a made-up `$0.00`.

## Deviations from the brief

1. `catalogue.rs` is a directory module (`catalogue/*.rs`) instead of one file — the repo's 200-line cap;
   the module path and ownership are as briefed, and sim-modules already exist under `oduse/`. The parser is
   still single: live payload, cache file and seed all end in the same `zen::Catalog` types, so there is no
   second parser to drift.
2. `cmduse/src/report_render.rs` (not in my list) needed one edit: `STATUSLINE_EXTRA_KEYS`. Its assertion
   rejects an undeclared statusline key, and the brief requires provenance in `statusline --json`. The three
   names added are `catalogSource`/`catalogAt`/`catalogAgeSecs`; the first two are the names the oduse lane
   already emits, so the family reads one name per concept and their test stopped failing on them.
3. `cmduse/src/ocuse/zen.rs` derives `Serialize` as well as `Deserialize` — the cache stores the seed shape,
   so `Catalog` must round-trip.
4. `--cache` and `--no-catalog` are lifted from argv in `ocuse/cli.rs` (like `model <id>`) because
   `cmduse/src/cli.rs` belongs to another lane. Their help is printed by `ocuse` right after the shared block,
   so `ocuse --help` documents them; the shared `OCUSE_HELP` still lacks them.

## Follow-ups (not mine to land)

- **`bun parity` is red**, and it is not from my files: `--cache`/`--no-catalog` are advertised by `oduse`
  only, so the check reports `missing on cmduse, arkuse`. Either add them to `cmduse`/`arkuse`'s help in
  `cmduse/src/cli.rs` (or accept them as shared no-ops) or allow-list them with a reason in
  `scripts/check-parity.ts`. `ocuse` itself already matches.
- `OCUSE_HELP` (`cmduse/src/cli.rs`) should carry the same two lines so the flag list is not split between
  two files; until then `ocuse --help` prints them from `ocuse/cli.rs`.
- The Zen half of the catalogue is still the seed: `/zen/v1/models` is a second endpoint, outside this
  brief. `plans`/`models` label the Go half's provenance; a consumer reading `zen` rows is reading the
  baked table.

## Commands run

```sh
cargo test                                    # 359 passed, 0 failed
cargo fmt --all -- --check                    # clean
cargo clippy --all-targets -- -D warnings     # clean
cargo build -p cmd-usage --bins               # all eight bins
mandoc -Tlint cmduse/cmduse.1                 # STYLE (long lines) only, no errors
bun parity                                    # FAIL: --cache/--no-catalog missing on cmduse, arkuse
```

While writing this, the parallel oduse lane's tree was briefly uncompilable (`oduse::Provenance` gaining an
`at` field, then `catalog_kind` not yet defined). I touched nothing there and re-ran the gate once it
compiled; the numbers above are from that run.
