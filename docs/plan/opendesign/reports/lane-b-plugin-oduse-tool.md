# Lane B — the OpenDesign plugin surface (`oduse_usage` + `/oduse-usage`)

## Verification of the pre-existing edits

Read every hunk in the seven owned files against the `arkuse` pattern. The earlier attempt had already landed the wiring correctly and line-for-line:

- `src/constants/providers.ts`: `ODUSE_TOOL_DESCRIPTION`, `ODUSE_TOOL_ARG_DESCRIPTION`, `ODUSE_USAGE_COMMAND_ID` present beside their siblings.
- `src/cli.ts`: `oduseArgs()` returns `-1` for empty/whitespace input, passes a non-empty arg through untouched; `runOduse` already existed and was reused, not duplicated.
- `src/index.ts` (v1): `cfg.command["oduse-usage"]` with the same description/template shape as the other three; `oduse_usage` in the `tool` record using `ODUSE_TOOL_DESCRIPTION` and `ODUSE_TOOL_ARG_DESCRIPTION`.
- `src/v2.ts`: `editor.add({ name: "oduse_usage", … })` after `arkuse_usage`, same `arg` property shape, `oduseArgs(arg)` on the execute path.
- `src/tui-commands.tsx`: `/oduse-usage` keymap-layer command with `ODUSE_USAGE_COMMAND_ID`, its id in `bindings`.
- `test/plugin.test.ts`: v1 key list and description assertion, v2 ordered `editor.add` name list plus description and `arg` description assertions.

No changes to `cmd_usage`, `ocuse_usage`, `arkuse_usage` or `mpc_prices` descriptions, args or ordering.

## Changes made this turn

- `src/constants/providers.ts`: fixed `ODUSE_TOOL_DESCRIPTION`'s example flag from `'--plan go-plus'` (an OpenCode Go plan, copied from the ocuse text) to `'--plan plus'`. `cmduse/src/oduse/od.rs` sets `DEFAULT_PLAN = "go"` and `cli/mod.rs` validates `--plan` against `catalog.plan_ids()`; OpenDesign plan ids are `go|plus|pro|max`, so `go-plus` was never a valid value.
- `README.md`: added `/oduse-usage` / `oduse_usage` / `oduse` to the `## Commands` table beside its three siblings and included `oduse` in the bare-command watch-loop note.
- `bun fmt` applied to `README.md`, `src/index.ts` and `src/v2.ts` (the added imports exceeded the configured line width). Formatting only; no behaviour change.
- Root `AGENTS.md` needs no tool-list edit: its only plugin-tool mention is a specific note about `mpc_prices`, not an enumeration of the four usage tools.

## Gate

`cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint` — all steps pass: 322 tests / 0 fail, 1289 assertions, no type errors in 80 files, 89 files formatted. `bunx biome lint` exits 0 with one pre-existing info: `biome.json` declares schema 2.6.3 while the CLI is 2.6.7. That config is outside this lane's file set and was left untouched.

## Not done

No commit, push, tag or publish. No change to files outside the seven owned ones. No opencode reload/restart.
