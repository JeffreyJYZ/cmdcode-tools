# Lane S — one tool description still omits the rule the other three state

## The finding, measured in a fresh session

`plugin-v0.5.38` is live and all four `*_usage` tools return. A fresh subagent quoted the four `arg` descriptions verbatim:

```
cmd_usage     "Optional: 'plans' for the plan table only, or extra cmduse flags (e.g. '--tz +05:30 daily')"
ocuse_usage   "Optional: extra ocuse flags (e.g. '--plan go-plus', '--json') added to the one-shot dashboard, or a subcommand (e.g. 'daily') run as-is; never starts the live watch loop"
arkuse_usage  "Optional: extra arkuse flags (e.g. '--plan medium', '--profile <name>', '--json') added to the one-shot dashboard, or a subcommand (e.g. 'daily') run as-is; never starts the live watch loop"
oduse_usage   "Optional: extra oduse flags (e.g. '--plan plus', '--session-cookie <path>', '--no-wallet', '--json') added to the one-shot dashboard, or a subcommand (e.g. 'daily') run as-is; never starts the live watch loop"
```

Three of four now describe the contract. `cmd_usage` does not — it is still the short single-line form from before the arg-hang fix.

**This is a wording gap, not a behaviour gap, and you must not "fix" behaviour.** Verified:

```
buildCmduseArgs("")            -> ["-1","--plain"]
buildCmduseArgs("--tz +05:30") -> ["-1","--plain","--tz","+05:30"]
buildCmduseArgs("plans")       -> ["plans"]          // subcommand: exits on its own
buildCmduseArgs("daily --json")-> ["daily","--json"]
cmd_usage with a flag, real spawn -> returned in 2.2s, 628 bytes
```

`cmduse plans` and `cmduse daily --json` each exit `0` standalone. The builder is correct and must stay as it is.

## What to change

1. **`TOOL_DESCRIPTION` / the cmd_usage `arg` description** in `opencode-plugin/src/constants/providers.ts`: bring it to the same shape the other three use — flags are added to the one-shot dashboard, a subcommand runs as-is, and the tool never starts the live watch loop. Keep cmduse's own examples (`'plans'`, `--tz +05:30`, `daily`) because they are the ones its binary actually accepts.
2. **Make the omission impossible to reintroduce.** Add a test asserting that all four `*_TOOL_ARG_DESCRIPTION` constants contain the same normative clause (e.g. the phrase about the live watch loop), keyed off one shared substring constant rather than four copies of the sentence. If the four descriptions genuinely need different examples, the *rule clause* is still common — assert the rule, not the prose.
3. **Check the main descriptions too.** `TOOL_DESCRIPTION`, `OCUSE_TOOL_DESCRIPTION`, `ARKUSE_TOOL_DESCRIPTION`, `ODUSE_TOOL_DESCRIPTION` — the last of these was already corrected for the monthly-window lie in 0.5.37. Confirm the other three do not make a claim their binary contradicts, and say which you checked rather than silently rewriting.
4. **Do not touch `buildCmduseArgs`, `dashboardArgs`, `ocuseArgs`, `arkuseArgs`, `oduseArgs` or `SUBCOMMANDS`.** Their behaviour is proven correct; a change there is a regression risk with no upside.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Never invoke a `*_usage` tool and never run a client binary without `timeout`** — a bare call hung this machine twice. Verify by reading constants and by `timeout N` on the CLI.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report; a later round decides whether this rides a patch.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `opencode-plugin/src/constants/providers.ts` and `opencode-plugin/test/plugin.test.ts` (or `test/cli.test.ts` if the description assertions already live there — check before adding a third home). **Do not touch** `opencode-plugin/src/cli.ts`, `src/{index,v2,tui-commands}.ts*`, `core/**`, `cmduse/**`, `oc-cmd-compare/**`, or any version file.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-s-cmd-tool-description.md`. Final chat reply under 12 lines: the new cmd_usage arg description, the shared clause the test pins, the sibling descriptions you verified, the gate result.
