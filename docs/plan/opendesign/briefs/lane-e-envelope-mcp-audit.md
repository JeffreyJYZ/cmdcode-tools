# Lane E — prove the four report envelopes and MCP tool sets really match

## Why this exists

Two parity claims are asserted by rule and never independently checked:

- **The report envelopes.** `daily`/`hourly` emit `{scope, source, total, days|hours}`; `model` emits `{scope, source, since, sinceMs, models}`; `session` carries **both** `sessions` and `projects` with identical rows. `REPORT_*_KEYS` in `report_render.rs` is meant to be the single source, and each binary is meant to assert its own emitter against it.
- **The MCP tool sets.** All four expose the same seven tools (`usage`, `plans`, `models`, `daily`, `hourly`, `session`, `model`) with the same arguments per tool, asserted through the shared `mcp_tests::tool_params`.

Both are the kind of claim that quietly rots: a key gets added to one emitter, a tool argument gets renamed in one binary, and nothing fails because each suite tests itself against its own copy. This lane is the audit that either proves them or finds the rot.

## The authoritative reference

1. Root `AGENTS.md`: the **"MCP parity is pinned on both axes"** paragraph (it lists the exact per-tool arguments) and the **"four report envelopes carry the same keys"** paragraph.
2. `cmduse/src/report_render.rs::REPORT_*_KEYS` and `cmduse/src/mcp_tests.rs::tool_params`.
3. Each binary's own envelope test — find them: `rg -n 'report_json_envelopes_are_the_shared_contract' cmduse/src`.

## What to do

1. **Run all four binaries for real** and capture the actual JSON key set of every report and every MCP tool:
   - `daily --json --days 2`, `hourly --json --hours 2`, `model --json --days 2`, `session --json`, `-1 --json` for each of `cmduse`, `ocuse`, `arkuse`, `oduse` (build first with `cargo build -p cmd-usage`).
   - `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./target/debug/<bin> mcp` for each.
   Paste the sorted key lists into the report as a matrix, binary × surface.
2. **Diff against the rule.** Every mismatch is either a defect in the emitter or a stale sentence in AGENTS.md. Decide which, per case, and record the decision and its evidence.
3. **Fix the emitters**, not the documentation, wherever the rule is right — the rule was written from the emitters and a doc loosened to match a bug is the worse outcome.
4. **Make the assertion shared.** If each binary genuinely re-declares its expected keys, replace the four copies with one shared constant so a fifth addition cannot drift. If the crate's module layout blocks that, say precisely why and leave the strongest achievable shared test.
5. **Prove the tests bite.** For each shared-contract test, temporarily remove one key from the emitter (or one argument from a tool schema), run the suite, confirm the expected test fails, then restore. Report the failing test name and its message as evidence. **Restore the tree exactly and re-run the gate green before you report** — a lane that leaves a mutation behind is worse than no lane.
6. **`rows` vs `limit`.** The rule makes `rows` canonical with `limit` an alias on `ocuse`/`arkuse`. Confirm both are accepted, both behave identically, and `0` means every row, on all four.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `cmduse/src/report_render.rs`, `cmduse/src/mcp_tests.rs`, the four MCP tool-schema files (`cmduse/src/{mcp,ocuse/mcp,arkuse/mcp,oduse/mcp}*`), the report/MCP test files per binary, and any doc sentence in `cmduse/README.md` / `cmduse/cmduse.1` that names a key or argument you change. **Do not touch** `core/od.json`, `cmduse/src/oduse/{od.rs,price.rs,snapshot.rs,api_wallet.rs,meter.rs}`, the statusline emitters, or `opencode-plugin/**` — four sibling lanes own those this round.
- Gate before you report: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`. Run every one in the foreground and wait for it inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-e-envelope-mcp-audit.md` as you go. Final chat reply under 15 lines: mismatches found, what you fixed, the mutation-test evidence, and the gate result.
