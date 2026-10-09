# AGENTS.md

Repository: `@jeffreyjyz/opencode-session-dir` — opencode v2 plugin binds extra working dirs to one session, durably across restarts. Inspired by `opencode-add-dir` (0xkuze): no code shared/copied, never edit that repo. Read-only clone at `~/dev/resources/add-dir-opencode`. Sits beside `cmduse`, `oc-cmd-compare` (`mpc`), `reqshape`, `opencode-context` and `opencode-shell-rc` in `~/dev/cmdcode-tools/`.

## Layout

```
src/index.ts   server half (v2 `{ id, setup }`): permission.evaluate + session.context hooks
src/tui.tsx    TUI half (./tui): /session-dir, /session-dir-list, /session-dir-remove
src/state.ts   the one shared store: $XDG_DATA_HOME/opencode/session-dir/bindings.json
src/context.ts system-prompt injection for the bound dirs
src/ids.ts     plugin id, slash names, keymap command ids
scripts/build-tui.ts  solid-transformed TUI bundle (see Traps)
index.js, tui.js      root shims for local-directory plugin loading (see Traps)
```

## Core rules

- **Session-scoped only.** Exactly one binding mode: durable, keyed by session id. Do not add global/process-wide mode — `opencode-add-dir` does that, reason this plugin exists.
- **Server never decides scope from anything but `event.sessionID`.** Both hooks filter through `bindingsFor(String(event.sessionID))`; binding for another session must never authorize this one.
- **Allow, never deny.** `permission.evaluate` only turns `ask` into `allow`, only for `action === "external_directory"` with `effect === "ask"`. Configured `deny` always wins.
- **Match directory boundaries, not string prefixes.** Resources are canonical boundaries (`<dir>/*`); strip trailing `/*`, compare with `isChildOf`, so `/boundary` never inside `/bound`.
- **Two halves share nothing but the file.** TUI writes, server reads via short mtime cache (`freshBindings`). Writes go through `addBinding` / `removeBinding`, which invalidate cache.

## Traps

- **`permission.evaluate` and `session.context` both carry `sessionID`** — use it. `PermissionEvaluation.sessionID` on event; `session.context` event exposes `sessionID` + mutable `system` array.
- **Delete session key when last binding removed** (in `removeBinding`), else `bindings.json` accumulates empty arrays.
- **`keymap.layer()` must run inside render.** Registering directly in `setup` throws `Keymap.Provider is missing`; app slot mounts no-op whose `render` calls it (cast to `() => JSX.Element`).
- **Directory-browser dialogs imperative** (`ui.dialog.select` / `prompt` / `confirm` / `alert`); nothing in TUI half needs JSX, but file is `.tsx` built through solid transform so future JSX stays reactive.
- **Build TUI with `@opentui/solid`'s transform**, not plain `bun build`. `@opentui/*` + `solid-js` stay external — host rewrites entry imports to own module instances.
- **`biome check .` aborts on nested root configuration when `.delta/` present**; this repo's `biome.json` excludes `**/.delta`.
- **Local-directory plugins resolve `index` / `server` / `tui` beside package root, not `exports` map.** Root `index.js` / `tui.js` shims re-export `dist/`; npm installs use `exports`. Keep in sync.

## Tests

Hermetic: every test points `HOME` + `XDG_DATA_HOME` at temp dir. Plugin test stubs `ctx.permission.hook` / `ctx.session.hook`, captures callbacks, drives them directly — no opencode process needed.

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Publishing (NEVER without explicit go)

Same policy as sibling repos: local commits only until user says push. Publishing from this account must go through `npm stage publish` + user's `npm stage approve` — bare `npm publish` leaves ghost versions (see the root `AGENTS.md`). `npm stage publish` leaves `0.0.0-stage` version in packument; staging placeholder, not ghost. Verify with raw packument, not `npm view` (cache can lag).

**Brand-new scoped package also goes through npm's automated review.** During it, `npm stage approve` returns `E409 ... can't be approved yet because automated review hasn't finished. Try again in a few minutes`, raw packument `404`s — even `npm stage list` shows nothing and `npm stage view <id>` says "staged version not found", looks exactly like lost stage. Tarball URL already `200`s while metadata does not. Do **not** re-stage: fails with `E409 Cannot stage previously published version "<ver>"`. Wait few minutes, re-check raw packument; appears as `latest` (with `0.0.0-stage` placeholder alongside) once review + propagation finish. After publish, opencode's per-package install cache can lag npm: `npm cache clean`, remove `~/.cache/opencode/npm/@jeffreyjyz/opencode-session-dir@latest`, then user restarts. **Never restart or reload opencode yourself.**
