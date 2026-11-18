# Lane S — cmd_usage arg description + recurrence guard

## Confirmed finding

`plugin-v0.5.38`: all four `*_usage` tools answer. Three sibling `arg`
descriptions state the one-shot/watch-loop contract; `cmd_usage` did not.
Wording only — no behaviour touched. `buildCmduseArgs`,
`dashboardArgs`/`ocuseArgs`/`arkuseArgs`/`oduseArgs`, `SUBCOMMANDS`, and every
client binary were left alone. No `*_usage` tool invoked, no client binary run
bare.

## What changed

Two files only: `opencode-plugin/src/constants/providers.ts` and
`opencode-plugin/test/plugin.test.ts`.

1. Added one shared normative clause constant:

   ```
   TOOL_ARG_WATCH_LOOP_CLAUSE = "never starts the live watch loop"
   ```

   The three existing sibling arg constants now concatenate this constant
   instead of repeating the sentence. Their resolved string values are
   byte-identical to before (verified by reading all four after the edit).

2. Added the missing cmd_usage arg constant:

   ```
   TOOL_ARG_DESCRIPTION =
     "Optional: extra cmduse flags (e.g. '--tz +05:30', '--json') added to the one-shot dashboard, or a subcommand (e.g. 'plans', 'daily') run as-is; never starts the live watch loop"
   ```

   Keeps cmduse's own examples (`plans`, `--tz +05:30`, `daily`).

3. New guard test in the `usage tool arg descriptions` describe block: every
   one of `TOOL_ARG_DESCRIPTION`, `OCUSE_TOOL_ARG_DESCRIPTION`,
   `ARKUSE_TOOL_ARG_DESCRIPTION`, `ODUSE_TOOL_ARG_DESCRIPTION` must contain the
   shared clause, plus "one-shot dashboard" and "subcommand". A second test
   pins the clause's own value so it cannot be gutted into an empty string.
   Keyed off one shared constant, not four copies — a fifth usage tool cannot
   omit the rule without a red test.

## Main descriptions checked (item 3)

Read, no claim found that the binary contradicts, no rewrite made:

- `TOOL_DESCRIPTION` — Command Code monthly credits + 5-hour/weekly windows:
  consistent with GOAT.
- `OCUSE_TOOL_DESCRIPTION` — Go/Zen window meters + per-model spend: consistent.
- `ARKUSE_TOOL_DESCRIPTION` — AFP 5-hour/weekly/monthly from arkcli: consistent.
- `ODUSE_TOOL_DESCRIPTION` — already fixed in 0.5.37; server windows are
  `(5h, weekly)` with a local monthly estimate. Existing test
  `oduse description does not list a monthly server window` still passes.

## Wiring note for the parent

`TOOL_ARG_DESCRIPTION` is defined but not yet imported: `src/index.ts` (line
~366) and `src/v2.ts` (line ~385) still carry the inline short arg string.
Those files are outside this lane's scope, so the guard test checks the four
constants only and stays green. Swap the two inline literals for the new
constant there to make the live tool descriptions match; the test will keep the
clause pinned afterwards.

## Gate

`cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`
→ exit 0. 363 pass / 0 fail (was 361 — two new tests), no type errors in 80
files, all 89 files formatted. Biome emits only the pre-existing schema-version
info (`biome.json` pins 2.6.3, CLI is 2.6.7), no findings in changed files.

Tree left dirty, no commit/push/tag/publish, no opencode reload.
