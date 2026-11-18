# Lane P — the follow-up patch: the two fixes that landed after `plugin-v0.5.36` was cut

## Why this lane exists

`plugin-v0.5.36` and `cmduse-v0.8.4` are immutable and published. Two changes landed **after** those tags were cut, so neither is shipped:

1. **The OpenDesign cache-rate fix** — `opencode-plugin/src/catalogOpenDesign.ts` now carries `cache: { read: 0.006, write: 0 }` instead of `{ read: 0, write: 0 }`. Lane O's work, sitting uncommitted in the tree.
2. **A false claim in a user-facing tool description** — review finding S1.

This lane cuts the patch that ships them, and nothing else.

## Finding S1, verbatim

`opencode-plugin/src/constants/providers.ts:100-101`:

```
"Fetch live OpenDesign usage: credits spent against the plan's server windows (5h, weekly, monthly), the wallet balance, and per-model spend. ..."
```

The snapshot supplies **two** windows, not three. Verified:

```
$ rg -n 'fn monthly' cmduse/src/oduse/snapshot.rs
(no output — there is no monthly accessor)
```

`dash.rs` keeps Monthly on the local store; the captured response body in
`docs/plan/opendesign/briefs/oduse-snapshot-meter.md` has exactly two `designPlanWindows`.

Every agent that reads that schema is told the wrong source for one of three figures. Fix the sentence so it says: server 5h and weekly, local monthly estimate.

While you are there, sweep the sibling descriptions for the same class of error — a description naming a source the code does not use. `ARKUSE_TOOL_DESCRIPTION`, `OCUSE_TOOL_DESCRIPTION`, `TOOL_DESCRIPTION` and `ODUSE_TOOL_ARG_DESCRIPTION` are all in the same file. Check each against its binary's actual behaviour (`--help`, the emitter) and report which you verified rather than silently rewriting all of them.

## What to build

1. **The S1 text fix**, in both the description constant and anywhere the same sentence is duplicated (check `opencode-plugin/src/index.ts`'s v1 `cfg.command` template and `tui-commands.tsx` — they carry their own prose and may repeat the claim).
2. **Commit lane O's cache fix** — it is already written and gated (342 tests pass), and it is currently uncommitted in the tree. Verify it yourself first: run the exact probe in its report and confirm `cache.read` is `0.006` for DeepSeek V4.1 Flash and `cost: []` for an unpriced model. If either is wrong, fix it; do not commit a claim you did not reproduce.
3. **Bump `opencode-plugin/package.json` `0.5.36` → `0.5.37`**, rebuild so `dist/` embeds the new version, tag `plugin-v0.5.37`, push that one tag, watch its run in the background, and confirm `npm latest` becomes 0.5.37.
4. **Prove it with the repo's script**, never by eye: `opencode-plugin/scripts/verify-release.ts 0.5.37 --source`.
5. **A test for S1's absence** — not for the exact prose (which will drift), but for the property: the oduse description must not claim a monthly *server* window while `snapshot.rs` has no monthly accessor. A simple assertion that the description does not contain "monthly" alongside "server" is enough, with a comment saying why.

## Coordination — read this before touching anything

Another lane is finishing the mpc release and is told to stop after it. It will not touch `opencode-plugin/src/**`, the version files, or create commits. **You own those now.** But:
- `plugin-v0.5.36` is already tagged and immutable. Never re-tag it, never force-push a tag, never amend the commit it points at.
- `cmduse-v0.8.4` and `mpc-v0.1.14` are not yours. Do not touch them.
- If a run for `plugin-v0.5.36` is still in progress when you start, wait for it to finish before creating `plugin-v0.5.37` — two npm publishes racing on the same package is how a ghost version appears.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Never run `npm publish` by hand** — it prints a one-time auth URL and waits, and OIDC publishing works from the tag. `cargo publish` is not needed by this lane.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- Watch CI runs with `background: true`, never foreground, and never poll an output file.
- **Your files:** `opencode-plugin/src/catalogOpenDesign.ts`, `opencode-plugin/src/constants/providers.ts`, `opencode-plugin/test/{catalogOpenDesign,plugin}.test.ts`, `opencode-plugin/src/index.ts` and `tui-commands.tsx` (description prose only), `opencode-plugin/package.json`, `opencode-plugin/dist/**`, and the lane reports. **Do not touch** `core/**`, `cmduse/**`, `oc-cmd-compare/**`, or any other version file.
- Gate before you tag: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call. Commodity commits: Conventional Commits, message written to a file and passed with `-F`, never a backtick inside a double-quoted message.

## Report

Append to `docs/plan/opendesign/reports/lane-p-followup-patch.md`. Final chat reply under 15 lines: the S1 wording, which sibling descriptions you verified, the cache probe output, the tag and its run conclusion, `npm latest` afterwards, and anything still open.
