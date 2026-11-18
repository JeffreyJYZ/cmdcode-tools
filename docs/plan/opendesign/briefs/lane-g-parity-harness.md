# Lane G — prove the four binaries really are at feature parity, and leave a harness that keeps it that way

## Why this exists

The parity rule is the loudest rule in this repo: any user-facing thing one binary gains lands in all four in the same change, and "a capability only one has is a **defect, not a backlog item**". Every lane this week found drift, and each found it by reading. Nothing *enforces* it.

This lane builds the enforcement: a check that compares the four CLIs and fails when one gains a surface the others lack, with an explicit, quoted allow-list of the differences the *source* genuinely forces. Then it runs on the current tree and reports — honestly — what still differs.

## What is already proven (do not re-derive)

- **Subcommands: identical.** `config daily hourly mcp model models plans session statusline` on all four.
- **MCP tools: identical.** Seven names, asserted per binary through `mcp_tests::tool_params`.
- **Report envelopes: identical.** Asserted against `REPORT_*_KEYS`.
- **`statusline --json`: one 14-key shared set** plus declared extras, asserted through `assert_statusline_keys`.
- **Flags: NOT identical**, measured on the current tree:

```
cmduse  --bar-width --bursts --csv --days --dismiss-update --gated --help --hours --interval --json --local --plain --rows --since --tz --version --watch
ocuse   …same + --db --infer-anniversary --no-api --period-start --plan --window
arkuse  …same + --db --infer-anniversary --no-api --period-start --plan --profile --window
oduse   …same + --db --infer-anniversary --no-wallet --period-start --plan --session-cookie --window   (no --gated)
```

Every one of those differences is *claimed* to be source-forced. Some are (`--local` is cmduse's account-vs-logs cut; `--plan` names a tier the other sources cannot report; `--profile` is arkcli's; `--session-cookie`/`--no-wallet` are OpenDesign's). Others are drift: `cmduse` lacks `--db`/`--window`/`--period-start`/`--infer-anniversary`, and `oduse` lacks `--gated`. **Decide each one on the record**, with the reason the source forces it or the change that closes it.

## What to build

1. **A parity check** that a test or a script can run. Two viable shapes — pick one and justify it:
   - a Rust integration test in the crate that shells `--help` for all four binaries and compares parsed surfaces; or
   - a Bun script (e.g. `scripts/check-parity.ts`) that runs the four binaries found via `CMDUSE_BIN`/`OCUSE_BIN`/`ARKUSE_BIN`/`ODUSE_BIN` (falling back to the `*dev` twins then the homebrew names) and prints a matrix.
   Either way it must (a) hold an **allow-list where every entry carries its reason as a string**, (b) fail with the exact missing/extra name, and (c) skip cleanly — not fail — when a binary is absent, since CI has no installed `cmduse`.
2. **Close the drift it finds**, on both sides where the rule says both: add the missing flags to `cmduse` and `--gated` to `oduse` if the sources can carry them, or add the allow-list entry with its reason if they cannot. A flag added to a binary must actually work, not just parse — if `cmduse --db` makes no sense, say so and allow-list it.
3. **Run it on the current tree** and paste the matrix in the report, with every remaining difference marked `source` (with its reason) or `defect` (with what you did).
4. **A test that the harness itself bites**: mutate one allow-list entry (remove a reason / add a fake flag to one binary's help) and show the check failing, then restore. Same discipline lane E used.
5. **Wire it where it will run**, without breaking CI: if it is a Bun script, add a `parity` script to the root `package.json` and note the command in the root `AGENTS.md` build/test block; if a Rust test, it lives in the normal `cargo test` and needs the skip guard. Never add it to CI in a way that requires an installed binary.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** the new parity check (a new file, or `cmduse/src/parity*.rs` plus its test), root `package.json` (the script entry only), and the root `AGENTS.md` build/test block. **Do not touch** `core/od.json`, `cmduse/src/oduse/**`, the statusline emitters, `report_render.rs`, `mcp_tests.rs`, or `opencode-plugin/**` — five sibling lanes own those.
- Gate before you report: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and (if you add one) `bun <script>` run for real against the current binaries. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-g-parity-harness.md`. Final chat reply under 15 lines: the matrix verdict, which differences you closed, which you allow-listed and why, the mutation evidence, the gate result.
