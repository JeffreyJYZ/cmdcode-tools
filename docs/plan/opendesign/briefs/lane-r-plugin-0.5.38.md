# Lane R — `plugin-v0.5.38`: ship the arg-hang fix, which 0.5.37 does not have

## What happened

Lane Q fixed the `*_usage` arg hang in the working tree. I then checked the **published** tarball and found the fix is not in it:

```
$ curl -sS .../opencode-command-code-0.5.37.tgz | tar -xzO package/dist/index.js | rg -A2 'function oduseArgs'
function oduseArgs(arg) {
  return arg !== undefined && arg.trim() !== "" ? arg : "-1";
}
```

That is the buggy version — verbatim pass-through, no `-1`. So `plugin-v0.5.37` shipped with the hang still in it, and the user hit it again:

> "WTF ITS STUCK DONT RUN IT"

The working tree, by contrast, has the correct shape:

```
opencode-plugin/src/cli.ts:108  function dashboardArgs(arg, defaults): string[]
	- no tokens            → [...defaults]
	- names a SUBCOMMAND   → tokens untouched
	- already has -1/--once → tokens untouched (never doubled)
	- otherwise            → [...defaults, ...tokens]

ocuseArgs / arkuseArgs / oduseArgs all delegate to it with ["-1"].
```

Verified in-tree:

```
oduse  | --no-wallet -> ["-1","--no-wallet"] | empty -> ["-1"] | daily -> ["daily"] | -1 --json -> ["-1","--json"]
ocuse  | --no-wallet -> ["-1","--no-wallet"] | empty -> ["-1"] | daily -> ["daily"]
arkuse | --no-wallet -> ["-1","--no-wallet"] | empty -> ["-1"] | daily -> ["daily"]
cmduse | --rows 5     -> ["-1","--plain","--rows","5"]
```

So all four builders now agree. Lane Q's work is correct — it just never got published.

## Your job

Cut `plugin-v0.5.38` carrying it. Nothing else.

1. **Do not change the logic.** Lane Q's `dashboardArgs` is right and its tests are green (361 pass). Read `docs/plan/opendesign/reports/lane-q-tool-arg-hang.md` and `opencode-plugin/src/cli.ts:108` and confirm the four cases above still hold, then leave the code alone.
2. **Bump `opencode-plugin/package.json` `0.5.37` → `0.5.38`** and rebuild so `dist/` embeds the new version. Confirm the built bundle actually contains the new function — `rg -A6 'function oduseArgs' opencode-plugin/dist/index.js` must show `dashboardArgs`, not the old ternary. **That check is the whole point of this lane**; a bumped version with the old bundle ships the hang again.
3. **Commit** the working-tree changes (`src/cli.ts`, `src/constants/cli.ts`, `src/constants/providers.ts`, the tests, `package.json`, `dist/**`) plus Lane Q's report and brief. Conventional Commits, message written to a file and passed with `-F`. Never `git add -A` — this tree has another session's dirty files in it (`oc-cmd-compare/src/index.ts` is dirty from somewhere else; leave it out).
4. **Tag `plugin-v0.5.38` and push** that one tag. Tags go out over `origin` here, not `bot` (`git push bot refs/tags/...` fails "correct access rights").
5. **Watch the run with `background: true`**, never foreground, and read the conclusion from the notification rather than polling.
6. **Verify**: `npm latest` for `@jeffreyjyz/opencode-command-code` reads `0.5.38`, then `opencode-plugin/scripts/verify-release.ts 0.5.38 --source` — **run that with `background: true` too, never foreground** (it polls the registry for minutes; the user has said this twice in caps).
7. **Then prove the published bundle is fixed**, without invoking the tool: download the 0.5.38 tarball and print its `function oduseArgs` body. It must show `dashboardArgs`. Paste it. **Do not call `oduse_usage` or any other `*_usage` tool** — the user has told you not to run it, and a hanging tool call is what this lane exists to prevent.
8. **Repoint the local pin**: `~/.config/opencode/opencode.json` plugins array currently carries `@jeffreyjyz/opencode-command-code@0.5.37`. Change it to `0.5.38`. Smallest possible edit, preserve formatting, validate with `bun -e 'JSON.parse(...)'`. Do not restart or reload opencode — the config hot-reloads.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Never run `npm publish` by hand** — OIDC from the tag is the path.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Never invoke a `*_usage` tool.** Verify by reading the bundle, not by calling it.
- Watch runs and verify-release with `background: true`, always.
- **Your files:** `opencode-plugin/src/cli.ts`, `src/constants/cli.ts`, `src/constants/providers.ts`, `test/cli.test.ts`, `package.json`, `dist/**`, the lane reports/briefs, and `~/.config/opencode/opencode.json` (the pin only). **Do not touch** `core/**`, `cmduse/**`, `oc-cmd-compare/**`, `opencode-plugin/src/{index,v2,tui-commands}.ts*`, `catalogOpenDesign.ts`, or any other version file.
- Gate before tagging: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-r-plugin-0.5.38.md`. Final chat reply under 15 lines: the published-bundle proof for 0.5.37, the same proof for 0.5.38, the run conclusion, `npm latest`, and the pin.
