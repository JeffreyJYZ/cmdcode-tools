# Lane T — inline `cmd_usage` arg description literals

## Substitutions

- `opencode-plugin/src/index.ts:365` — v1 `cmd_usage` arg was `.describe("Optional: 'plans' for the plan table only, or extra cmduse flags")`. Now `.describe(TOOL_ARG_DESCRIPTION)`; import added beside the other `*_TOOL_ARG_DESCRIPTION` imports. Bun fmt collapsed the multi-line call to `arg: z.string().optional().describe(TOOL_ARG_DESCRIPTION)`.
- `opencode-plugin/src/v2.ts:384` — v2 added-tool arg was `description: "Optional: 'plans' for the plan table only, or extra cmduse flags (e.g. '--tz +05:30 daily')"`. Now `description: TOOL_ARG_DESCRIPTION`; import added.
- No structural changes beyond these two substitutions plus imports. `src/constants/providers.ts` untouched (lane S's constants are correct).

## Test that would have caught it

Lane S's guard asserts the constants, so it stayed green while the live registration was wrong. Added assertions in `opencode-plugin/test/plugin.test.ts` that read what each half passes to the host:

- v1: build `CommandCodePlugin({})`, then `plugin.tool.cmd_usage.args.arg` description through a narrow cast helper (`v1ArgDescription`, needed because zod's public `$ZodType` hides `.description`). Assert it equals `TOOL_ARG_DESCRIPTION`, contains `TOOL_ARG_WATCH_LOOP_CLAUSE`, and does **not** contain the old literal's phrase `'plans' for the plan table only`. Same assertion for `mpc_prices`, `ocuse_usage`, `arkuse_usage`, `oduse_usage` args.
- v2: drive `commandCodeV2.setup(ctx)`, find the added `cmd_usage` tool, assert `input.properties.arg.description` equals `TOOL_ARG_DESCRIPTION`, contains the shared clause, and lacks the old phrase. Same for the other four tools' arg descriptions already present in that test.
- Reverting either substitution now fails the test.

## Inline literal sweep

`rg -n '\.describe\("|description: "'` on `src/index.ts` and `src/v2.ts`:

- `src/v2.ts`: no matches after the fix.
- `src/index.ts`: four matches at lines 319, 326, 333, 340 — these are slash-command *command* descriptions (`description: "Show Command Code plan, credits, and usage windows"` etc.), not tool arg descriptions. They are genuinely local to the `/cmd-usage`, `/ocuse-usage`, `/arkuse-usage`, `/oduse-usage` commands and duplicate no constant. Left alone per the brief.
- The two tool-registration literals that duplicated `TOOL_ARG_DESCRIPTION` are the ones fixed above. No other inline literal shadows a constant.

## Gate

`cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint` — all green:

- `bun test`: 363 pass, 0 fail (29 files).
- `bun check`: no type errors in 80 files.
- `bun fmt --check`: all 89 files formatted.
- `bunx biome lint`: exit 0, one info-only note that `biome.json` pins schema 2.6.3 while CLI is 2.6.7 (pre-existing, no fixes applied).

Note: on the first two full-suite runs, `test/cli.test.ts`'s `runOduse` shim test (2000 ms timeout) failed intermittently only when run alongside other files; it passes in isolation and the final full-suite run was green. Unrelated to this lane — no cli code touched.
