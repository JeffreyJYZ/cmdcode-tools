# Lane J — pre-release review of the whole uncommitted tree

Reviewer: Lane J. Date: 2026-11-18. Read-only on product code. Tree: 96 changed paths on `main`, six sibling lanes' work uncommitted.

Every number below was re-derived. Nothing was trusted from a lane report without a re-run. Scratch script: `docs/plan/opendesign/reports/scratch/verify-rates.ts` (throwaway, reads only).

## Blocking

### B1 — No version bump exists for the stated release

**Where:** `cmduse/Cargo.toml:3`, `core/Cargo.toml:3`, `Cargo.lock:49`, `opencode-plugin/package.json:3`.

**Failure:** The brief states this tree is about to ship as cmduse 0.8.4 and plugin 0.5.36. The tree still carries the already-published versions. `release.yml` builds with `--locked`, so a `cmduse-v0.8.4` tag built from this tree either publishes 0.8.3 again (crates.io rejects a reused version) or fails the lock check. `npm-plugin.yml` refuses a `plugin-v0.5.36` tag whose `package.json` reads 0.5.35.

**Reproduction (run):**

```
$ rg -n '^version' cmduse/Cargo.toml core/Cargo.toml
cmduse/Cargo.toml:3:version = "0.8.3"
core/Cargo.toml:3:version = "2.3.0"
$ rg -n -A1 'name = "cmd-usage"' Cargo.lock
48:name = "cmd-usage"
49-version = "0.8.3"
$ rg -n '"version"' opencode-plugin/package.json | head -1
3:	"version": "0.5.35",
$ git diff -- Cargo.toml cmduse/Cargo.toml core/Cargo.toml opencode-plugin/package.json Cargo.lock | rg 'version'
(no output)
```

Note: this may be a deliberate final release step rather than a lane omission. It is still a gate that must be cleared before either tag is pushed.

## Should fix

### S1 — The shipped `oduse_usage` tool description claims a server monthly window that does not exist

**Where:** `opencode-plugin/src/constants/providers.ts:100-101`.

**Failure:** `ODUSE_TOOL_DESCRIPTION` says "credits spent against the plan's server windows (5h, weekly, monthly)". The snapshot supplies only `5h` and `7d`: `snapshot.rs:51-56` exposes `five_hour()` and `weekly()` only, `dash.rs:119-134` keeps Monthly on the local store, and the captured body in `docs/plan/opendesign/briefs/oduse-snapshot-meter.md:16-21` has exactly two `designPlanWindows`. The description is user-facing schema text in both v1 and v2, so every agent that sees the tool is told a false source for one of three figures.

**Reproduction (run):**

```
$ rg -n 'fn five_hour|fn weekly' cmduse/src/oduse/snapshot.rs
51:    pub fn five_hour(&self) -> Option<&Window> {
54:    pub fn weekly(&self) -> Option<&Window> {
$ rg -n 'Monthly' cmduse/src/oduse/render/dash.rs
122:        label: "Monthly",
```

Fix the text to say server 5h/weekly and a local monthly estimate.

### S2 — `CREDIT_TO_USD`'s "proved by the ledger" comment overstates the available evidence

**Where:** `cmduse/src/oduse/snapshot.rs:12-17`.

**Failure:** The comment says "Proved by the ledger on this account: `listChargedUsd 0.0043` ↔ `listChargeCredits 43`". Those two numbers appear nowhere as an observed response in any report. They exist only as a sentence in the pre-work brief (`docs/plan/opendesign/briefs/oduse-snapshot-meter.md:26`); the rate lane's report repeats the brief rather than a captured body (`reports/oduse-snapshot-meter.md:15`). The arithmetic is sound (`43 × 0.0001 = 0.0043`, `50,000 × 0.0001 = $5.00`), but calling an uncited brief line an account observation invites a future reader to trust a factor nobody reproduced.

**Reproduction (run):**

```
$ rg -n 'listCharge' docs/plan/opendesign
briefs/oduse-snapshot-meter.md:26:Units: one credit is $0.0001. The ledger proves it (`listChargedUsd 0.0043` ↔ `listChargeCredits 43`).
reports/oduse-snapshot-meter.md:15:- `CREDIT_TO_USD = 0.0001`, one named constant with the ledger proof in the comment (`listChargedUsd 0.0043` ↔ `listChargeCredits 43`).
```

(no raw `billing/ledger` response, no `listCharge*` key in `od-usage-api-hunt.md`.) Either capture the ledger body next to the constant or soften the comment to "per the brief's ledger observation".

### S3 — `statusline --json` still reports local windows while the dashboard reports the server meter

**Where:** `cmduse/src/oduse/render/status.rs:84-120` (no `snapshot`, `meterSource` or `snapshotError` key), against `render/json.rs:146-152` and `render/dash.rs:67-100`.

**Failure:** With a session cookie the human-facing frame prints the server's 5-hour/weekly credits and `windows: account snapshot`. `statusline --json`, consumed by prompts and status bars, prints `fiveHourSpent`/`weeklySpent` from the local store and carries no key naming the source. The two surfaces disagree on the same quantity, and the machine consumer cannot tell which one it is reading. The rest of this release went to some trouble to make the server meter win and to expose `meterSource` on the dashboard JSON.

**Reproduction (run):**

```
$ rg -n 'snapshot|meterSource' cmduse/src/oduse/render/status.rs
(no output)
$ target/debug/odusedev statusline --json | jq '{fiveHourSpent,weeklySpent,source}'
{
  "fiveHourSpent": 0.6603101280000002,
  "weeklySpent": 11.268583710719996,
  "source": "open-design"
}
```

Either mirror the snapshot keys into statusline or state in the emitter's doc that statusline is deliberately local-only.

### S4 — Lane A's headline "gap closed from 7.03 to 1.03" is anchored to a stale baseline

**Where:** `docs/plan/opendesign/reports/lane-a-od-rates.md:19-23`.

**Failure:** The report's own table gives the measured before figure as 5.681, then computes the 7.03 gap from the brief's older $5.11. That mixes two baselines. Re-running the same comparison now gives 5.801 → 11.282, so the gap against the brief's 12.14 server figure is 6.34 → 0.86, not 7.03 → 1.03. The direction and the conclusion hold; the quoted numbers do not reproduce.

**Reproduction (run):**

```
$ timeout 90 /opt/homebrew/bin/oduse -1 --no-wallet --json | jq -c .summary
{"costUsd":11.92604934000002,"credits":5.801011980000004,"requests":8977,...}
$ timeout 90 target/debug/odusedev -1 --no-wallet --json | jq -c .summary
{"costUsd":22.665590615999996,"credits":11.281666782719999,"requests":8977,...}
```

Absolute figures drift as turns arrive; the report should quote the command and the measured pair, not a gap against a stale external number.

## Nit

- **Stale "three binaries" prose survives.** Lane E's report (`lane-e-envelope-mcp-audit.md:70-73`) claims to have fixed three files but left others. Still present: `cmduse/src/cli.rs:78`, `cmduse/src/arkuse/cli.rs:13`, `cmduse/src/arkuse/render.rs:5,148,916`, `cmduse/src/ocuse/render.rs:1505,2680`, `cmduse/src/oduse/period.rs:3`, `cmduse/src/oduse/watch.rs:3`, `cmduse/src/oduse/render/json.rs:3,72`, `cmduse/src/oduse/render/status.rs:114`, `cmduse/src/oduse/tests/render_json.rs:104`. Some are "other three" relative to the fourth binary and are correct; the unqualified "all three binaries" ones are not.
- **`od.rs:110-114` documents `catalog_id()` as a repo-catalogue lookup, but no pricing path calls it any more.** It is still emitted in `render/catalog_json.rs:97,122`, so it is not dead data — only the doc comment is stale.
- **`opencode-plugin/src/catalogOpenDesign.ts:134-136` still advertises `cache: {read: 0, write: 0}`** for every model while the release now prices cache reads from the published list. This is pre-existing (the diff only changes the `rateSource` filter), so it is not a regression, but the plugin's model records still tell the host cache reads are free.
- **Line cap:** 13 reviewed Rust/TS files exceed 200 lines already (largest `v2.ts` 696, `useRows.ts` 510, `rows.ts` 482). All pre-existing; lane C records this as out of scope.

## Verified

- **All 46 rate rows match the published reference, by script, not by eye.** `bun docs/plan/opendesign/reports/scratch/verify-rates.ts` compared `core/od.json` to `docs/plan/opendesign/reference/od-model-prices.json` on `input`, `output`, `cacheRead`, `cacheWrite`, `longContext` and `rateSource`, and independently checked the 46 hardcoded constants in `tests/published_rates.rs`. Output: `od.json models: 46; reference rows: 46`, `TOTAL MISMATCHES: 0`, `TEST CONST ROWS CHECKED: 46`, `FINAL MISMATCHES: 0`.
- **The pinned rate test is reachable and green.** `cargo test -p cmd-usage --lib every_published_row` → `test oduse::tests::published_rates::every_published_row_matches_the_reference_payload ... ok`. The module is wired at `cmduse/src/oduse/tests/mod.rs:15`.
- **`turn_cost` uses the fresh-input counter for the long-context threshold.** `od.rs:186-197` compares the first argument (`row.input`, `price.rs:31`) against `input_tokens_above`; `db.rs:29-31` keeps `input` and `cache_read` as disjoint counters. Strict `>` and whole-turn repricing are pinned in `tests/published_rates.rs:101-156`.
- **`CREDIT_TO_USD` arithmetic is self-consistent.** `43 × 0.0001 = 0.0043`, `50,000 × 0.0001 = $5.00`, `150,000 × 0.0001 = $15.00`. The `snapshot.rs:14-15` claim that these equal the published $18/$55 at Eco's 0.27 is approximate (4.86 and 14.85), not exact as written. Evidence provenance is the S2 finding.
- **All four statusline tests call the real emitter, not a hand-built JSON.** `cmduse/src/render_tests.rs:420` → `crate::statusline_json` (the function `statusline_cmd` calls at `lib.rs:899`); `ocuse/render.rs:2329` → `statusline_json`; `arkuse/render.rs:1700` → `statusline_json`; `oduse/render/status.rs:144` → `statusline_json(&report, plan)`. Each passes through `report_render::assert_statusline_keys`. `cargo test -p cmd-usage --lib` → `330 passed; 0 failed`.
- **`oduse_usage` cannot start the watch loop.** Ran a Bun eval of the real module: `oduseArgs(undefined|""|"   ") → "-1" → ["-1"]`; `" daily --json" → ["daily","--json"]`; `"--plan plus" → ["--plan","plus"]`. Both halves call it (`index.ts:423`, `v2.ts:505`, plus `tui-commands.tsx:119`). `--json` alone also exits: `timeout 15 target/debug/odusedev --json --no-wallet` → `exit=0`, 3158 bytes of JSON.
- **Dead-code sweep found no half-finished rename.** `zen_cache_read`: zero hits. `"repo"`: only test fixtures/comments in `render_catalog.rs:65` and test prose; no value comparison remains. `monthlyCap`: legitimate dashboard/sidebar field (`sidebar/rows.ts:172`, `sidebar/data.ts:64`, and cmduse's `-1 --json` dashboard), not a stale statusline alias — `statusline --json` emits `monthCap`. `three binaries`: see Nit.
- **Report envelope and MCP parity hold.** `bun parity` → `PASS parity check: 4 binaries, 28 flags, 11 allowed differences`; every difference carries a reason. `cargo test -p cmd-usage --lib` green. The four emitters and the shared key constants agree; I did not re-run lane E's eight mutations (they are destructive and were reversed by that lane), so that part of its report remains a claim.
- **Statusline null-vs-zero rule holds where it matters.** `odusedev --plan pro statusline --json` → `"fiveHourCap": null`, `"monthCap": 480.0`, `"weeklyCap": 90.0`; `cmduse`'s `statusline_json` maps an unpublished cap to `null` and derives `monthSpent` only from a published cap (`lib.rs:871-876`). `window_caps` handles an empty model set without unwrapping (`caps.rs:86-91`).
