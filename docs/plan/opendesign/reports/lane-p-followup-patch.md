# Lane P report — the follow-up patch after `plugin-v0.5.36`

## S1 fix

`opencode-plugin/src/constants/providers.ts:100-101` claimed a monthly **server** window. `cmduse/src/oduse/snapshot.rs` has only `fiveHour()` and `weekly()` accessors (`rg -n 'fn monthly' cmduse/src/oduse/snapshot.rs` -> no output); `dash.rs` keeps Monthly on the local store. New wording:

> Fetch live OpenDesign usage: credits spent against the plan's server windows (5h, weekly) and a local monthly estimate, the wallet balance, and per-model spend. Defaults to the one-shot dashboard; pass extra oduse flags for more (e.g. '--plan plus', 'daily', '--json').

Duplicates checked: `opencode-plugin/src/index.ts:339` says only "server windows" (no monthly) - accurate; `opencode-plugin/src/tui-commands.tsx` carries only the command id/title, no source claim. No other prose repeats the false claim.

Regression test added to `opencode-plugin/test/plugin.test.ts`: extracts the parenthesized server-window list from `ODUSE_TOOL_DESCRIPTION` and asserts it is non-empty and does not contain "monthly". Property, not exact prose, so an honest "local monthly estimate" elsewhere in the sentence stays legal.

## Sibling descriptions verified (no change)

- `ARKUSE_TOOL_DESCRIPTION` - arkcli supplies the 5h/daily/weekly/monthly meters, local per-model AFP, reconciliation. Matches `AGENTS.md` and the arkuse source shape.
- `OCUSE_TOOL_DESCRIPTION` - 5-hour & weekly windows plus billing-period summary; no false source named.
- `TOOL_DESCRIPTION` (cmduse) - monthly credits, 5-hour & weekly windows, billing-period summary; matches the credit-pool source.
- `ODUSE_TOOL_ARG_DESCRIPTION` - '--plan plus', '--session-cookie <path>', '--no-wallet', '--json' all exist in `cmduse/src/oduse/help.rs:39-41`.

## Lane O cache fix reproduced

Exact probe from `docs/plan/opendesign/briefs/lane-o-plugin-cache-rates.md:31`:

```
published: [{"input":0.3,"output":1.2,"cache":{"read":0.006,"write":0}}]
unpriced: []
```

`cache.read` is `0.006` for DeepSeek V4.1 Flash; an unpriced model still yields `cost: []`. Committed as-is.

## Gate

`bun test && bun check && bun fmt --check && bunx biome lint`: 343 pass / 0 fail (1364 expects), no type errors in 80 files, 89 files formatted, biome lint exit 0 (one informational schema-version notice: config 2.6.3, CLI 2.6.7). `opencode-plugin/dist/index.js` rebuilt and embeds `version: "0.5.37"`.

## Release

Pending: `plugin-v0.5.36` run `44247321813` was still `in_progress` when this was written. Tag/push/watch/`verify-release`/`npm latest` will be appended after it finishes.
