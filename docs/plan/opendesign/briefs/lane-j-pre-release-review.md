# Lane J — adversarial review of the whole uncommitted diff before it ships

## Why this exists

Six lanes have written into one working tree and nobody has read the result as a whole. Every lane gated its own files; none read the others'. This tree is 95 changed paths and is about to be released as `cmduse` 0.8.4 and `plugin` 0.5.36, meaning a mistake here reaches every user of four binaries at once.

Your job is to be the reviewer who finds the defect before the release does. **Read only — you change no product code.** You may add test files if you find an untested behaviour, but prefer reporting.

## Start here

```
git status --short
git diff --stat
git diff                      # the whole tree, in pieces
```

Group the changes by lane before reading them: `core/od.json` + `cmduse/src/oduse/{od,price}.rs` (rates), `cmduse/src/oduse/{snapshot,snapshot_window,api_wallet,meter}.rs` (server meter), `cmduse/src/oduse/render/**`, `cmduse/src/report_render.rs` + `mcp_tests.rs` (shared contracts), `opencode-plugin/src/{index,v2,cli,tui-commands}.ts*` + `constants/providers.ts` (the fourth tool), `opencode-plugin/src/sidebar/**` (four-family parity), and `docs/plan/opendesign/**` (reports only).

## What to look for — in this order

1. **Arithmetic that is load-bearing.** `core/od.json`'s rates are the entire point of this release. Spot-check at least ten rows against `docs/plan/opendesign/reference/od-model-prices.json` with a script, not by eye. Then verify one turn end-to-end: a known `input`/`output`/`cache_read` triple priced through `od.rs::turn_cost` must equal the published-rate product. Confirm the `longContext` threshold compares against the counter the code actually has (the store's `input` is the fresh counter and `cache_read` is disjoint — a threshold compared against the wrong one silently never fires or always fires).
2. **`CREDIT_TO_USD = 0.0001`.** This constant converts every server figure. Prove it from the ledger shape recorded in the report (`listChargedUsd` ↔ `listChargeCredits`) and say whether the code's doc comment states evidence or a guess.
3. **A dropped shared key.** `STATUSLINE_KEYS` is 14 keys and `assert_statusline_keys` rejects an undeclared extra. Confirm every binary's emitter really emits all 14, and that the assertion is *reachable* — a test that constructs its own JSON instead of calling the emitter proves nothing. Read each of the four tests and say which call the real emitter.
4. **The fourth tool's dispatch.** `oduse_usage` must never start the watch loop. Trace `oduseArgs("")` → `"-1"` and confirm the v1 and v2 halves both call it, and that a non-empty arg is passed through unmangled (`splitCliArgs` on `" daily --json"`).
5. **A regression the gates cannot see.** `cargo test` is green, but green tests with a behaviour change is the classic shape of a regression. Look specifically for: a previously-`Some` price becoming `None` (an unlabelled `rateSource` now renders `—`), a `null` cap becoming `0`, a report row being dropped by `--rows`, and any place `unwrap`/`expect` now runs on data a real store can produce (an empty `models` map, a zero-request session, a model id absent from the 46).
6. **Dead code and stale prose.** `rg` for `zen_cache_read`, `"repo"`, `monthlyCap`, `three binaries`, `rateSource ==` — a leftover of any of those means a lane half-finished. Also check `cmduse/README.md` and `cmduse/cmduse.1` did not gain a claim the code does not implement.
7. **The reports.** Each lane wrote a report; a report is a claim, not evidence. For every load-bearing number in `docs/plan/opendesign/reports/lane-*.md`, re-derive it or mark it unverified. That includes lane A's "gap closed from 7.03 to 1.03".

## Deliverable

`docs/plan/opendesign/reports/lane-j-pre-release-review.md`, structured as:

- **Blocking** — a defect that must not ship. Each with file:line, the failure it causes, and a reproduction you actually ran.
- **Should fix** — wrong but not user-visible, with the same evidence discipline.
- **Nit** — style, naming, comment accuracy.
- **Verified** — the claims you checked and how.

Rank within each section by blast radius. Quote the command output, never a number alone.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Do not modify any file outside your own report.** If you must prove something with code, write a throwaway under `docs/plan/opendesign/reports/scratch/` and say it is throwaway. Five sibling lanes are still editing `cmduse/**` and `opencode-plugin/**`; touching their files loses their work.
- You may run `cargo test`, `cargo clippy`, `bun test`, `bun check` and any read-only command. Do not `cargo clean`, do not delete build artifacts.

## Report

The report file is the deliverable. Final chat reply under 15 lines: how many blocking, how many should-fix, and the single worst thing you found.
