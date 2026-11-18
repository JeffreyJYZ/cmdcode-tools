# Lane L — make `statusline --json` tell the truth about its own source

## The finding

Lane J's review, `docs/plan/opendesign/reports/lane-j-pre-release-review.md`, ranked this the worst *product* defect in the release:

> **S3** — With a session cookie the human-facing frame prints the server's 5-hour/weekly credits and `windows: account snapshot`. `statusline --json` prints `fiveHourSpent`/`weeklySpent` from the local store and carries **no key naming the source**. The two surfaces disagree on the same quantity, and the machine consumer cannot tell which one it is reading.

Reproduced:

```
$ rg -n 'snapshot|meterSource' cmduse/src/oduse/render/status.rs
(no output)
$ target/debug/odusedev statusline --json | jq '{fiveHourSpent,weeklySpent,source}'
{ "fiveHourSpent": 0.66, "weeklySpent": 11.27, "source": "open-design" }
```

`source` here names the *store*, not the *meter*. A prompt or status bar reading it believes it has the account's number; with a cookie present it has the local estimate, and the dashboard beside it is printing a different figure for the same window.

Also in scope, ranked **S2**: `cmduse/src/oduse/snapshot.rs:12-17` says the credit factor is "Proved by the ledger on this account: `listChargedUsd 0.0043` ↔ `listChargeCredits 43`", but no raw `billing/ledger` body exists anywhere in the repo — the numbers appear only in a brief. The arithmetic is right (`43 × 0.0001 = 0.0043`), the provenance claim is not.

## What to build

### 1. Carry the meter source into `statusline --json`

Add the keys the dashboard already has, so a machine consumer can tell which meter produced the number:

- `meterSource`: `"snapshot"` when the server windows produced the figure, `"local"` when the store did — the same two values `render/json.rs` already emits, so the vocabulary does not fork.
- `snapshotError`: absent or `null` when there was no attempt or it succeeded; the reason string when a cookie existed and the request failed. Match `render/json.rs`'s behaviour exactly rather than inventing a third convention.
- Whatever else `render/json.rs` exposes that names provenance and costs nothing to mirror (`plan` is already there).

**Both lives must agree.** When the frame prints server windows, `statusline`'s `fiveHourSpent`/`weeklySpent` must be the same numbers, not the local ones. Read `render/json.rs:146-152` and `dash.rs:67-100` and reuse the same resolution path — a second copy of "which meter wins" is how the two surfaces drifted in the first place. If the resolution lives in a helper that `status.rs` cannot reach, move it somewhere both can, and say so.

Add the new keys to `report_render.rs`'s shared constants: `meterSource` and `snapshotError` go in `STATUSLINE_EXTRA_KEYS` (they are OpenDesign's, and only OpenDesign has a server meter to name), **not** in `STATUSLINE_KEYS` — `cmduse`, `ocuse` and `arkuse` must not be forced to emit a key they have no concept for. Keep the assertion honest.

### 2. Fix the provenance claim in `snapshot.rs`

Two acceptable outcomes; pick one and be explicit:

- **capture the evidence** — the ledger shape is reproducible from the account API (`GET .../billing/ledger`), so record the exact request and a real response body in `docs/plan/opendesign/reference/` beside the price payload, then quote that file in the comment; or
- **soften to what is actually known** — "the ledger shape reported in `<doc>` places one credit at $0.0001; the arithmetic below reproduces $5.00 / $15.00 for the 5h and weekly windows at Eco's 0.27× (4.86 and 14.85, i.e. close, not exact)". Lane J also flags that the comment implies the Eco figures are exact when they are 4.86 and 14.85 — fix that too, since a reader who checks will find the mismatch.

Never keep a comment that presents a brief's sentence as an observation.

### 3. Tests

- A test proving `meterSource` is `"snapshot"` when a snapshot is present and `"local"` when it is not, calling the real `statusline_json` (the same seam the existing four statusline tests use — lane J verified all four call the real emitter; keep that property).
- A test proving the 5h/weekly figures in `statusline` equal the snapshot's when the snapshot wins. That is the actual defect, so it needs its own assertion, not just a key check.
- A test that the shared key assertion still passes for all four binaries after the constant change.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `cmduse/src/oduse/render/status.rs`, `cmduse/src/oduse/render/json.rs` (only if the resolution helper must move there), `cmduse/src/report_render.rs` (the two constants), `cmduse/src/oduse/snapshot.rs` (the comment), `cmduse/src/oduse/tests/**`, `cmduse/src/render_tests.rs` if the shared assertion needs it, and `docs/plan/opendesign/reference/` if you capture the ledger. **Do not touch** `core/od.json`, `cmduse/src/oduse/{od,price}.rs`, `cmduse/src/oduse/tests/published_rates.rs`, `oc-cmd-compare/**`, or `opencode-plugin/**` — sibling lanes own those.
- Gate before you report: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and a real `./target/debug/odusedev statusline --json` plus `--plan pro` run pasted in the report. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-l-statusline-meter-source.md`. Final chat reply under 15 lines: the new keys, whether the two surfaces now agree (with both numbers), how you fixed the provenance claim, the gate result.
