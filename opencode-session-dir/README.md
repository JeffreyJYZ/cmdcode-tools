# @jeffreyjyz/opencode-session-dir

Bind extra working directories to one opencode session — durably, across restarts. Other sessions never see them.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-session-dir?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/opencode-session-dir)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

The agent already works in the session's own directory; anything outside it
needs `external_directory` approval. This plugin lets a session declare the
other directories it may work in, and remembers that binding for that session
alone. Open a different session and the same path is still gated by the normal
permission flow.

## Install

Add it to the `plugins` array in `~/.config/opencode/opencode.json` and restart
(or `/reload`) opencode:

```json
{
  "plugins": ["@jeffreyjyz/opencode-session-dir"]
}
```

For local development point at the checkout instead (an absolute path is
treated as a local plugin):

```json
{
  "plugins": ["/Users/you/dev/cmdcode-tools/opencode-session-dir"]
}
```

After `bun run build` the root `index.js` / `tui.js` shims load `dist/`.

## Commands

| Command | Behavior |
| --- | --- |
| `/session-dir` | Browse (or type) a directory and bind it to the current session. |
| `/session-dir-list` | Show the directories bound to the current session. |
| `/session-dir-remove` | Pick a bound directory and unbind it. |

All three require an open session; they act on the active session only.

## How it works

Two halves of one package, because they run in different processes:

| half | file | job |
| --- | --- | --- |
| server | `src/index.ts` | `permission.evaluate` grants `external_directory` for the requesting session's bound dirs; `session.context` advertises them to the model |
| TUI | `src/tui.tsx` | the three slash commands and their dialogs |

Both halves meet on the filesystem. Bindings live in
`$XDG_DATA_HOME/opencode/session-dir/bindings.json` (default
`~/.local/share/opencode/session-dir/bindings.json`) as a map from session id to
absolute paths:

```json
{
  "ses_abc123": ["/Users/you/other-project"]
}
```

The server reads it through a short mtime cache, so a binding added in the TUI
takes effect on the next permission check. A configured `deny` in your
`permissions` always wins — the hook only turns `ask` into `allow`.

Set `OPENCODE_SESSION_DIR_INJECT_CONTEXT=1` to also fold each bound directory's
`AGENTS.md` / `CLAUDE.md` / `.agents/AGENTS.md` into the system prompt.

## Difference from `opencode-add-dir`

`opencode-add-dir` offers "this session only" (a flat list, cleared when the
server restarts and shared by every session in that process) and "remember
across sessions" (persisted, but global to all sessions). This plugin is the
combination it does not offer: **one session, durable**.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-session-dir)
- [npm: @jeffreyjyz/opencode-session-dir](https://www.npmjs.com/package/@jeffreyjyz/opencode-session-dir)
- [MIT license](LICENSE)
