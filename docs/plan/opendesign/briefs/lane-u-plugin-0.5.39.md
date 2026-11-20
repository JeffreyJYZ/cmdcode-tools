# Lane U — `plugin-v0.5.39`: ship the description parity that 0.5.38 left in the tree

## Why

`plugin-v0.5.38` published the *behaviour* fix (`dashboardArgs`, so no `*_usage` tool can hang) but lanes S and T landed **after** that tag. Their five files are uncommitted right now, so npm still serves the old text:

```
fresh session on 0.5.38 (quoted verbatim):
  cmd_usage  "Optional: 'plans' for the plan table only, or extra cmduse flags"

working tree now:
  cmd_usage  "Optional: extra cmduse flags (e.g. '--tz +05:30', '--json') added to the one-shot dashboard,
              or a subcommand (e.g. 'plans', 'daily') run as-is; never starts the live watch loop"
```

So three of four tools describe the contract and the fourth does not — in the artifact users install. That is the last parity gap. Ship it.

## Already verified — do not re-derive

I confirmed these myself, in this session:

```
v1 registration (plugin.tool.cmd_usage.args.arg.description)  → the full fixed sentence, rule clause present
v2 registration (added tool's input.properties.arg.description):
  cmd_usage     RULE ok
  mpc_prices    RULE MISSING   ← correct: `bunx mpc --help` has no --watch flag
  ocuse_usage   RULE ok
  arkuse_usage  RULE ok
  oduse_usage   RULE ok
gate: bun test 363 pass / 0 fail, bun check clean, bun fmt --check 89/89 formatted
```

**`mpc_prices` is deliberately exempt** — its binary has no watch loop, so the clause would be a false claim. Do not "fix" it.

## What to do

1. **Bump `opencode-plugin/package.json` `0.5.38` → `0.5.39`.**
2. **Rebuild** so `dist/` embeds the new version and the new strings. Then prove it in the bundle before committing: `rg -c 'never starts the live watch loop' opencode-plugin/dist/index.js` must be at least **3**, and `rg -c "plans' for the plan table only" opencode-plugin/dist/index.js` must be **0**. A bump with a stale bundle is the exact failure `0.5.37` taught; check the built artifact, not the source.
3. **Commit by explicit path**, two commits:
   - the description parity + its registration test: `opencode-plugin/src/constants/providers.ts`, `opencode-plugin/src/index.ts`, `opencode-plugin/src/v2.ts`, `opencode-plugin/test/plugin.test.ts`, plus `docs/plan/opendesign/briefs/lane-s-*.md`, `lane-t-*.md` and their reports;
   - the version bump + rebuilt `dist/**` + `package.json`.
   **Never `git add -A`.** `oc-cmd-compare/src/index.ts` and `reqshape/src/index.ts` are dirty from other sessions — stage neither, mention neither in a commit message.
4. **Tag `plugin-v0.5.39` and push over `origin`** (not `bot` — tag pushes there fail "correct access rights").
5. **Watch the run with `background: true`**, never foreground. Read the conclusion from the notification. Wait for it before creating the pin change.
6. **Verify, in this order:**
   - tarball: `curl -sS -o /dev/null -w '%{http_code}' https://registry.npmjs.org/@jeffreyjyz%2fopencode-command-code/-/opencode-command-code-0.5.39.tgz` → **must be 200**, not 404. A `latest` dist-tag flipping while the tarball 404s is the ghost-version shape this repo has hit before.
   - `opencode-plugin/scripts/verify-release.ts 0.5.39 --source` — **background, never foreground** (it polls for minutes; the user has said this twice in caps).
   - **the published bundle**: download the 0.5.39 tarball and `rg -A3 'TOOL_ARG_DESCRIPTION =' package/dist/index.js`. It must show the watch-loop clause. Paste the line.
7. **Only then repoint** `~/.config/opencode/opencode.json` from `...@0.5.38` to `...@0.5.39`. Smallest possible edit, validate with `bun -e 'JSON.parse(...)'`. Do not restart or reload opencode.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Never invoke a `*_usage` tool** and never run a client binary without `timeout` — a bare call hung this machine twice. Verify by reading bundles and registrations.
- **Never run `npm publish` by hand** — OIDC from the tag is the path.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- `gh run watch`, `verify-release.ts` and any registry poll: `background: true`, always.
- **Your files:** the four plugin source/test files, `opencode-plugin/package.json`, `opencode-plugin/dist/**`, the lane briefs/reports, and `~/.config/opencode/opencode.json` (the pin only). **Do not touch** `core/**`, `cmduse/**`, `oc-cmd-compare/**`, `reqshape/**`, `catalogOpenDesign.ts`, or any other version file.
- Gate before tagging: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-u-plugin-0.5.39.md`. Final chat reply under 15 lines: the pre-commit bundle check, the tag, the run conclusion, the tarball code, the published-bundle grep, `npm latest`, and the pin.
