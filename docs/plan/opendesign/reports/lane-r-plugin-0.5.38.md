# Lane R — `plugin-v0.5.38`: DONE

## Why this release exists

`plugin-v0.5.37` shipped without Lane Q's arg-hang fix. Proof from the published
tarball (no tool call, bundle read only):

```
$ curl -sS https://registry.npmjs.org/@jeffreyjyz/opencode-command-code/-/opencode-command-code-0.5.37.tgz | tar -xzO package/dist/index.js | rg -A6 'function oduseArgs'
function oduseArgs(arg) {
  return arg !== undefined && arg.trim() !== "" ? arg : "-1";
}
```

That is the buggy verbatim pass-through: a flag-only arg never gets `-1`, so the
binary starts the live watch loop and the tool call hangs.

## In-tree fix (Lane Q, unchanged)

`opencode-plugin/src/cli.ts:108` `dashboardArgs(arg, defaults)` — no tokens →
`[...defaults]`; subcommand → untouched; explicit `-1`/`--once` → untouched;
otherwise → `[...defaults, ...tokens]`. `ocuseArgs`/`arkuseArgs`/`oduseArgs`
delegate with `["-1"]`. Confirmed the four cases still hold — see
`test/cli.test.ts:235-246` and Lane Q's report. Logic left alone.

## Bump + rebuild

- `opencode-plugin/package.json`: `0.5.37` → `0.5.38`.
- `cd opencode-plugin && bun run build` → exit 0 (98 modules, version string
  embedded in `dist/index.js:2417`).
- Critical check on the freshly built bundle:

```
$ rg -A6 'function oduseArgs' opencode-plugin/dist/index.js
function oduseArgs(arg) {
  return dashboardArgs(arg, ["-1"]);
}
$ rg -n '0\.5\.3[78]' opencode-plugin/dist/index.js
2417:  version: "0.5.38",
```

`dist/` is gitignored and not tracked; `npm-plugin.yml` runs `bun run build`
in CI from the tag (verified in the workflow). It is rebuilt locally only to
prove the fix reaches the bundle, not committed.

## Gate (foreground, waited on)

`cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`
→ exit 0: 361 pass / 0 fail, no type errors in 80 files, 89 files formatted,
Biome 1 pre-existing info (config pins 2.6.3, CLI 2.6.7), no warnings in changed files.

## Commit + tag

- Commit `56c9e38 fix(plugin): ship the tool arg one-shot fix in 0.5.38` —
  explicit paths only; another session's `oc-cmd-compare/src/index.ts` and
  `reqshape/src/index.ts` stayed out.
- Tag `plugin-v0.5.38` pushed over `origin` (not `bot`), as required.

## Run + release verification

- `plugin-v0.5.38` / `Publish npm package` run `44257511950` → success in 5m20s
  (all steps green including "Verify the tarball is actually served"); watched
  with `background: true`, conclusion read from the completion notification.
- `npm latest @jeffreyjyz/opencode-command-code` → `0.5.38`.
- `bun scripts/verify-release.ts 0.5.38 --source` (background) → verified:
  `latest=0.5.38 version=yes tarball=200`, sha1
  `d524a21fc96097f60ef9af9b0bba50fa972d82b0`, repository
  `git+https://github.com/JeffreyJYZ/cmdcode-tools.git`.

## Published 0.5.38 bundle proof (bundle read only, no tool call)

```
$ curl -sS .../opencode-command-code-0.5.38.tgz | tar -xzO package/dist/index.js | rg -A6 'function oduseArgs'
function oduseArgs(arg) {
  return dashboardArgs(arg, ["-1"]);
}
```

The fix is in the published artifact. No `*_usage` tool was invoked at any
point in this lane.

## Local pin

`~/.config/opencode/opencode.json:134` →
`"@jeffreyjyz/opencode-command-code@0.5.38",`; `JSON.parse` validated. No
opencode reload or restart.
