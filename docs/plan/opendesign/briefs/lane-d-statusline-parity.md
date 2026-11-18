# Lane D — `statusline --json` must carry the same keys on all four binaries

## Why this exists

Measured on the current tree, the four binaries disagree:

```
cmduse  fiveHourCap fiveHourSpent fiveHourUsed monthCap monthSpent monthlyCap monthlyRemaining plan weeklyCap weeklySpent weeklyUsed
ocuse   fiveHourCap fiveHourSpent model monthCap monthSpent period plan weeklyCap weeklySpent
arkuse  account accountError afp fiveHourCap fiveHourSpent model monthCap monthSpent period periodEnd plan source weeklyCap weeklySpent
oduse   capLabel fiveHourCap fiveHourSpent model monthCap monthSpent period plan walletSource walletUsd weeklyCap weeklySpent
```

The rule says a consumer must never branch per binary: every `-1 --json` carries `source`, the period bounds and a `summary`; `statusline --json` uses `fiveHourSpent`/`fiveHourCap`, `weeklySpent`/`weeklyCap`, `monthSpent`/`monthCap` on all four, and `cmduse`'s older `fiveHourUsed`/`weeklyUsed`/`monthlyRemaining` stay as **aliases**.

`cmduse` is missing `source`, `period`, `periodEnd`, `model` and `account`; `ocuse`, `arkuse` and `oduse` are missing the three `cmduse` aliases; each carries a family-specific extra key (`monthlyCap`, `afp`, `capLabel`, `walletUsd`). Some of those extras are legitimate (they name a unit that only that source has) and some are drift. This lane decides each one, on the record.

## The authoritative rule

1. Root `AGENTS.md`, the paragraph beginning **"The machine-readable surfaces use one set of names where the concept is the same"** — it names the six required keys, the aliases, and the one case where a value is `null` rather than `0`.
2. The four emitters: `cmduse/src/statusline.rs` (or wherever its JSON is built), `cmduse/src/ocuse/render/status.rs`, `cmduse/src/arkuse/render/status.rs`, `cmduse/src/oduse/render/status.rs`.
3. Their existing tests, which assert each emitter's own key set.

## What to change

1. **Bring all four to one superset key set** — the six required meter keys plus `plan`, `source`, `period`, `periodEnd`, `model`. A family-specific unit key may stay only when it names something no other family has a concept for, and the report must say which and why.
2. **`cmduse` gains the keys it lacks**, and its `monthSpent` keeps the documented derivation (`cap − remaining`, clamped at zero) with the older `monthlyRemaining` retained as an alias. Add the aliases to the other three so a consumer reading `fiveHourUsed` works against any binary.
3. **A cap a plan does not publish is `null`, never `0`** — check every emitter does that, including a plan with no 5-hour window.
4. **One test per binary asserting the shared key set**, so dropping a key from any one of them fails that binary's suite. Prefer a single shared expected list (a `const` in the same place `report_render.rs` keeps `REPORT_*_KEYS`) over four hand-written copies — a fourth copy is how the drift started. If a shared const is impractical across the crate boundary, say why in the report.
5. **`cmduse/README.md`, `cmduse/cmduse.1`** — any key list or `statusline` example that names the old set gets the new one, in the same commit-shaped change.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** the four statusline emitters and their tests, plus `cmduse/README.md` and `cmduse/cmduse.1`. **Do not touch** `core/od.json`, `cmduse/src/oduse/{od.rs,price.rs,snapshot.rs,api_wallet.rs,meter.rs}`, `cmduse/src/oduse/tests/*`, `opencode-plugin/**` — three sibling lanes own those this round.
- Gate before you report: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`. Run every one in the foreground and wait for it inside the same call. A red gate is not a finished lane.

## Report

Append to `docs/plan/opendesign/reports/lane-d-statusline-parity.md` as you go. Include the before/after key dump for all four binaries — run each `statusline --json` and paste the sorted key lists. Final chat reply under 15 lines.
