# AGENTS.md

Repository: `@jeffreyjyz/opencode-context` — provider-agnostic opencode plugin showing where a session's context window went. Sits beside `cmduse`, `oc-cmd-compare` (`mpc`) and `reqshape` in `~/dev/cmdcode-tools/`; shares no code with them, not Command-Code-specific.

## Layout

```
src/index.ts      server half (v2 `{ id, setup }`): the `session.context` hook that
                  captures system-prompt/tool-definition sizes, plus the
                  `context_breakdown` tool
src/tui.tsx       TUI half (`./tui`): the `/context` slash command + dialog
src/breakdown.ts  pure: replayable messages -> buckets. The ONE classification point
src/collect.ts    TUI collector: session.context + model limit + agent system + capture
src/capture.ts    cross-process sizes cache ($XDG_CACHE_HOME/opencode-context/<session>.json)
src/dialog.tsx    the dialog JSX (flex layout, stacked bar, rows)
src/format.ts     bytes / tokens / percent
src/constants/    module-scope data constants: ids.ts (plugin/command ids),
                  dialog.ts (palette, column widths, row glyphs, child cap),
                  tool.ts (context_breakdown tool description)
scripts/preview.tsx  headless frame preview: `bun run scripts/preview.tsx [width] [spans]`
scripts/opentui-clip-space-bug.tsx  standalone upstream repro (see Traps)
index.js, tui.js  root shims for local-directory plugin loading (see Traps)
```

## Core rules

- **One classification point: `breakdown.ts`.** Both halves feed it same shapes; never classify parts elsewhere, or dialog and tool disagree.
- **System prompt and tool definitions are not in the message store.** Assembled per request in server process. Server half measures them in `session.context`, writes *sizes only* to capture file; TUI dialog reads it. When capture missing (no request yet), System Prompt row falls back to `AgentInfo.system`, Tool Definitions hidden — never invent those numbers.
- **`session.context` is the replayable context, not full history.** Post-compaction, exactly what provider would receive. Read via `ctx.client.session.context({ sessionID })` in TUI and `ctx.session.context({ sessionID })` in server so breakdown describes loaded window.
- **Bytes are UTF-8; tokens are a 4-chars/token estimate.** Header's `used / limit` is provider's measured number (`tokens.input + output + reasoning + cache.read + cache.write` of last assistant turn). Never present per-row estimate as exact.
- **Two halves share nothing but the filesystem.** Run in different processes (server half's state not TUI-visible), so capture is a file, not plugin storage.

## Traps

- **Local-directory plugins resolve `index` / `server` / `tui` beside package root, not the `exports` map.** Repo ships root `index.js`/`tui.js` shims re-exporting `dist/`; npm installs use `exports`. Keep shims in sync with `dist/`.
- **`<span fg={…}>` silently ignored; spans need `<span style={{ fg }}>`.** Pass colours per segment, not per text node.
- **TUI app-slot `render` must return void, not `null`** — `null` leaves an empty box painting a stray line in the prompt area. `ctx.keymap.layer()` must be called inside a render, so the app slot mounts no-op and registers there.
- **Custom dialog JSX works**: `ctx.ui.dialog.show(() => <X/>)` then `ctx.ui.dialog.set({ size: "large" })`; not `alert()`-only.
- **Keymap command has no session prop.** Active session from `ctx.ui.router.current()` — handle `route.type === "session"`, else toast.
- **`model.list` returns `{ location, data }`**, not a bare array — read `.data`. `Tool.Context` gives tools `sessionID` (and `agent`); `AgentInfo` carries `system`.
- **`biome check .` aborts on a nested root configuration when `.delta/` is present**; this repo's `biome.json` excludes `**/.delta`.
- **Build TUI with `@opentui/solid`'s transform** (`scripts/build-tui.ts`), not plain `bun build`: plain JSX evaluates props at element creation and the panel freezes at mount. `@opentui/*` and `solid-js` stay external because the host rewrites the entry's imports to its own module instances.
- **Dialog lays out with flexbox, not fixed-width strings.** Rows fill `width="100%"`, label is a `flexGrow` spacer, size/percent are fixed columns pushed right — a `padEnd`/`padStart` block floats or squishes because the dialog's inner width is not known to render. Bar is a row of `flexGrow`-weighted boxes with `backgroundColor`, so it spans the dialog; a repeated glyph run cannot.
- **`captureCharFrame()` cannot show the bar's background colour** — a plain frame renders blanks. Use `captureSpans()` (sum `span.width`, count distinct `span.bg`) or `bun run scripts/preview.tsx <width> spans`; `test/dialog-render.test.tsx` is the guard.
- **ASCII space inside flex-row `<text>` can be painted/captured as a stray character.** Cause is **clipping**: the glyph appears only when the render frame is *shorter* than the content, height-parity dependent. Fix is **U+00A0** — `dialog.tsx` renders `label.replace(/ /g, "\u00a0")`, lays out identically and paints correctly; the render test normalises NBSP back to space. Flat row list / spacer box did **not** fix it — only NBSP did. `testRender`'s fixed frame clips; **live dialog is content-sized and never clips**, so NBSP is harmless insurance, not a live fix. Repro: `bun run scripts/opentui-clip-space-bug.tsx`. **Not filed, on purpose** — `testRender`-only artifact.

## Build & test

```sh
bun install
bun test          # breakdown + plugin-shape tests, hermetic
bun run typecheck
bun run build     # server bundle + solid-transformed tui + declarations
```

`dist/index.js` must import only node builtins at runtime (no `@opencode/*`), so a fresh opencode start does not install the provider/effect graph before the plugin appears. `@opencode/plugin` is devDependency, type-only.

## Publishing (NEVER without explicit go)

Same policy as sibling repos: local commits only until user says push. Publishing from this account must go through `npm stage publish` + user's `npm stage approve` — bare `npm publish` leaves ghost versions (see `cmduse/AGENTS.md` for the full trap). Version this package independently. After publish, opencode's per-package install cache can lag npm: `npm cache clean`, remove `~/.cache/opencode/npm/@jeffreyjyz/opencode-context@latest`, then user restarts. **Never restart or reload opencode yourself.**

- **`npm stage publish` failing `E401 "authentication token seems to be invalid"` is a dead `~/.npmrc` token, not a staging problem.** Confirm with `npm whoami` (also 401). This account's token is invalidated by npm's bypass-2FA restriction; fix interactively — user runs `npm login` (browser), then re-stage. Do not log in from the agent shell, do not paste/log the token (rotate if leaked into transcript).
