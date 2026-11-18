# Lane B — the OpenDesign plugin surface (`oduse_usage` + `/oduse-usage`)

## Why this exists

The repo ships four sibling readers and the plugin exposes three of them to the agent: `cmd_usage` + `/cmd-usage`, `ocuse_usage` + `/ocuse-usage`, `arkuse_usage` + `/arkuse-usage`. OpenDesign (`oduse`) has **no tool, no slash command, no TUI binding** — so the fourth member of a family that is required to stay at feature parity is invisible to the agent. This lane closes that.

## The authoritative reference

`opencode-plugin/AGENTS.md` and the root `AGENTS.md` both state the parity rule: a user-facing thing one binary gains lands in all of them, and the same is true of the plugin surface. Copy the shape of `arkuse_usage` exactly — it is the closest sibling (same `arg`-only schema, same empty-arg-means-`-1` rule, same thin-spawn wrapper).

## What is already on disk (a previous attempt, unverified)

Some edits were made before this lane existed. **Verify each, keep what is correct, rewrite what is not — you own these files now.** Concretely, check for:

1. `opencode-plugin/src/constants/providers.ts` — `ODUSE_TOOL_DESCRIPTION`, `ODUSE_TOOL_ARG_DESCRIPTION`, `ODUSE_USAGE_COMMAND_ID`.
2. `opencode-plugin/src/cli.ts` — `oduseArgs()` (empty arg becomes `-1`, never the watch loop). `runOduse` already exists and is already used by the sidebar; do not duplicate it.
3. `opencode-plugin/src/index.ts` — the v1 half: `cfg.command["oduse-usage"]` and a `tool.oduse_usage` entry in the `tool` record.
4. `opencode-plugin/src/v2.ts` — the v2 half: `editor.add({ name: "oduse_usage", … })` in the tool transform.
5. `opencode-plugin/src/tui-commands.tsx` — the `/oduse-usage` command in the keymap layer, plus its id in `bindings`.
6. `opencode-plugin/test/plugin.test.ts` — the two registration assertions.

A `bun check` and `bun test` on this tree currently pass; that is not proof the wiring is right. Read each hunk and confirm it matches the arkuse pattern line for line.

## What must be true when you finish

- `oduse_usage` is registered in **both** halves (v1 `tool` record and v2 `editor.add`), with `ODUSE_TOOL_DESCRIPTION` and an `arg` property documented by `ODUSE_TOOL_ARG_DESCRIPTION`.
- Empty / whitespace `arg` dispatches `-1`; a non-empty arg passes through untouched, so `" daily --json"` works and a bare invocation never starts the watch loop.
- `/oduse-usage` exists as a v1 `cfg.command` **and** as a v2 keymap-layer command, both suggesting the same tool, both with their id in `bindings`.
- The slash-command test in `test/plugin.test.ts` asserts the new tool's description and `arg` description, and the ordered `editor.add` name list includes `oduse_usage` in the position the code registers it.
- **No behaviour changes to the other three lanes.** `cmd_usage`, `ocuse_usage`, `arkuse_usage` and `mpc_prices` keep their exact descriptions, args and ordering. A diff that reflows them is a defect.
- `opencode-plugin/README.md` (if it lists the slash commands or tools) gains `oduse_usage` / `/oduse-usage` beside its siblings. Same for any list in the root `AGENTS.md` that enumerates the plugin's tools.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode.
- Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `opencode-plugin/src/index.ts`, `opencode-plugin/src/v2.ts`, `opencode-plugin/src/cli.ts`, `opencode-plugin/src/tui-commands.tsx`, `opencode-plugin/src/constants/providers.ts`, `opencode-plugin/test/plugin.test.ts`, `opencode-plugin/README.md`. **Do not touch** `core/od.json`, `cmduse/**`, or `opencode-plugin/src/catalogOpenDesign.ts` — a sibling lane owns the pricing side this round, and two writers on one file loses one of the two changes.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. A red gate is not a finished lane. Run every one in the foreground and wait for it inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-b-plugin-oduse-tool.md` as you go, and keep your final chat reply under 15 lines: what you verified, what you changed, the gate result, and anything you could not do.
