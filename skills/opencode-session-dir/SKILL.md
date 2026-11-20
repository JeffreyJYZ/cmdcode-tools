---
name: opencode-session-dir
description: "Use when the user needs the agent to work in a sibling repo or a directory outside the session root without repeated external_directory approvals, or wants that access to survive a restart."
---

# opencode-session-dir

`@jeffreyjyz/opencode-session-dir` — opencode v2 plugin. The agent works in the session's own directory; anything outside it needs `external_directory` approval. This plugin lets a session declare the other directories it may work in and remembers the binding for **that session alone**, durably across restarts. A different session sees the same path gated normally.

## Install

In `~/.config/opencode/opencode.json`:

```json
{ "plugins": ["@jeffreyjyz/opencode-session-dir"] }
```

Restart or `/reload` opencode. A local checkout path works too. After `bun run build`, root `index.js`/`tui.js` shims load `dist/`.

## Commands

| Command               | Behavior                                                         |
| --------------------- | ---------------------------------------------------------------- |
| `/session-dir`        | Browse (or type) a directory and bind it to the current session. |
| `/session-dir-list`   | Show directories bound to the current session.                   |
| `/session-dir-remove` | Pick a bound directory and unbind it.                            |

All three require an open session and act on the active one only.

## Storage and config

Bindings live in `$XDG_DATA_HOME/opencode/session-dir/bindings.json` (default `~/.local/share/opencode/session-dir/bindings.json`) as a map from session id to absolute paths:

```json
{ "ses_abc123": ["/Users/you/other-project"] }
```

Set `OPENCODE_SESSION_DIR_INJECT_CONTEXT=1` to also fold each bound directory's `AGENTS.md` / `CLAUDE.md` / `.agents/AGENTS.md` into the system prompt.

## Traps

- Exactly one scope: durable, keyed by session id. There is no global/process-wide mode — that is `opencode-add-dir`, which this plugin deliberately does not copy.
- The server decides scope only from `event.sessionID`; a binding for another session never authorizes this one.
- Allow, never deny: the hook only turns `external_directory` with `effect: "ask"` into `allow`. A configured `deny` always wins.
- Directory matching is by canonical boundary (`<dir>/*`), not string prefix, so `/bound` is not inside `/boundary`.
- The TUI writes the file; the server reads it through a short mtime cache. The session's last binding removal deletes its key so the map does not accumulate empty arrays.
- Local-directory loading resolves `index`/`tui` beside the package root, not the `exports` map; keep shims in sync with `dist/`.
- After publishing, opencode's per-package install cache can lag npm. Clear `~/.cache/opencode/npm/@jeffreyjyz/opencode-session-dir@latest` and let the user restart; never restart opencode yourself.

Details: [opencode-session-dir README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-session-dir#readme).
