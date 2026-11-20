# Lane T — the two inline strings that keep `cmd_usage`'s old description live

## The finding

Lane S fixed `TOOL_ARG_DESCRIPTION` and pinned the shared rule clause, but flagged the real reason the tool text never changed: **both plugin halves register `cmd_usage` with an inline literal, not the constant.**

```
opencode-plugin/src/index.ts:366   "Optional: 'plans' for the plan table only, or extra cmduse flags"
opencode-plugin/src/v2.ts:385      "Optional: 'plans' for the plan table only, or extra cmduse flags (e.g. '--tz +05:30 daily')"
```

Meanwhile the constant it should use is correct:

```
opencode-plugin/src/constants/providers.ts:78  TOOL_ARG_DESCRIPTION =
  "Optional: extra cmduse flags (e.g. '--tz +05:30', '--json') added to the one-shot dashboard,
   or a subcommand (e.g. 'plans', 'daily') run as-is; never starts the live watch loop"
```

Confirmed live: a fresh subagent on `plugin-v0.5.38` quoted `cmd_usage`'s arg as the short form, while `ocuse_usage`, `arkuse_usage` and `oduse_usage` — which all `.describe(OCUSE_TOOL_ARG_DESCRIPTION)` and friends — showed the fixed text.

**This is also why lane S's guard test is green while the shipped text is wrong**: the test asserts the constants, and the constants are fine; nothing exercises what the two halves actually pass to `.describe()`.

## What to change

1. **Replace both literals with the constant.** `src/index.ts:365-367` becomes `.describe(TOOL_ARG_DESCRIPTION)`, and `src/v2.ts:385` becomes `description: TOOL_ARG_DESCRIPTION`. Import it in both files beside the other `*_TOOL_ARG_DESCRIPTION` imports. Keep the surrounding structure untouched — this is a two-line substitution per file, not a refactor.
2. **Close the test gap, which matters more than the strings.** Add a test that asserts the *registration*, not the constant:
   - v1: build the plugin (`await CommandCodePlugin({})`), read `plugin.tool.cmd_usage.args`, and check the `arg` field's description is `TOOL_ARG_DESCRIPTION` — then that it contains the shared watch-loop clause.
   - v2: drive `commandCodeV2.setup(ctx)` with the fake editor already used in `plugin.test.ts`, find the added `cmd_usage` tool, and assert the same.
   A test that would have caught this must read what is passed to the host, not what the constants file says.
3. **Apply the same reasoning to the other three.** They currently use constants, so they are correct — but assert them too, in the same test, so a future inline literal anywhere fails. `mpc_prices`'s arg too.
4. **Sweep for other inline description literals** that shadow a constant: `rg -n '\.describe\("|description: "' opencode-plugin/src/{index,v2}.ts`. Report each hit and whether it duplicates a constant. Fix only the ones that duplicate a constant or make a claim the binary contradicts; leave a genuinely local string alone and say why.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Never invoke a `*_usage` tool and never run a client binary without `timeout`** — a bare call hung this machine twice. Verify by reading what is registered, not by calling it.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `opencode-plugin/src/index.ts`, `opencode-plugin/src/v2.ts`, `opencode-plugin/test/plugin.test.ts`. **Do not touch** `src/constants/providers.ts` (lane S's constants are correct), `src/cli.ts`, `src/tui-commands.tsx`, `core/**`, `cmduse/**`, `oc-cmd-compare/**`, or any version file.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-t-inline-description-literals.md`. Final chat reply under 12 lines: the two substitutions, the test that would have caught it, other inline literals found, the gate result.
