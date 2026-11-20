---
name: opencode-shell-rc
description: "Use when the user's agent shell reports command not found for an alias that works in their own terminal, when they want a habit command like grep or sed blocked in agent shells, or when they need agent-only environment variables without touching .zshrc."
---

# opencode-shell-rc

opencode v2 plugin (server half only). opencode's shell tool runs `/bin/zsh -c …` non-interactively, so `~/.zshrc` is never read and an alias like `gp='git push'` fails. This plugin points every agent zsh at a fast `ZDOTDIR` shim that sources your aliases/functions without oh-my-zsh, `compinit`, autosuggestions, or syntax highlighting on every command.

## Install

Add to the `plugins` array in `~/.config/opencode/opencode.json`, then restart or `/reload` opencode:

```json
{ "plugins": ["@jeffreyjyz/opencode-shell-rc"] }
```

A local checkout path works too. After `bun run build`, the root `index.js` shim loads `dist/`.

Alias and function edits are picked up on the next command with no restart. A `PATH` change is **not** snapshotted — it needs an opencode restart.

## Config files

- `~/.config/opencode/shell-rc.json` — the plugin config (keys `env` and `blocked`).
- `~/.config/opencode/shell.zsh` — agent-only zsh, sourced **after** the guards and env layer; the escape hatch to undo a guard or compute a value.
- Global `~/.config/opencode/AGENTS.md` — the auto-generated alias index lives between `<!-- shell-rc-aliases-begin -->` and `<!-- shell-rc-aliases-end -->`.

### `blocked` (new array-of-objects schema, current since 0.5.0)

```json
{
	"blocked": [
		{ "name": "grep", "alternative": "rg", "reason": "respects .gitignore and is faster" },
		{ "name": "sed", "alternative": "sd (or read for line ranges)" },
		{ "name": "tccutil", "reason": "TCC changes are the user's; there is no grant verb" }
	]
}
```

Fields: `name` (required; `[A-Za-z0-9._+-]+` after trim), `alternative` (optional command line; its first word is checked against `PATH`), `reason` (optional short sentence, shown in parentheses).

Message: `<name> is blocked in agent shells — ` then `use <alternative>` when the alternative's first word resolves on `PATH`, else the `reason`, else the bare `alternative`. A `reason` is appended to the `use` form. Trailing parentheses in an alternative are not doubled, so `sd (or read for line ranges)` stays verbatim.

Backwards compatibility: the old string map (`{"grep": "rg"}`) is still accepted and becomes `{name, alternative: value}` per pair, but it is legacy. Missing, non-object, or malformed `blocked` falls back to the defaults (empty). Duplicate `name`: the later entry wins. Order is preserved. Invalid names, blank entries, and `cat` are skipped.

To convert a legacy map on disk run `shell-rc-migrate` (`--dry-run`, `--check`, `--config <path>`); it keeps a one-shot backup, and both forms render identical guards.

### `env`

```json
{ "env": { "JYZ_ENV": "staging", "API_BASE": "http://localhost:8080" } }
```

Values are literal, single-quoted into the generated script, so `$`, backticks, spaces, and quotes survive. Malformed names and non-string values are dropped; an empty map writes no file.

## Traps

- Nothing is blocked by default (`DEFAULT_BLOCKED` is empty); no guard file is written until you opt in. `cat` is never worth blocking — `bat` reformats, so a piped reader gets something that is not the file.
- Guards are a speed bump, not a jail, and affect agent shells only. zsh functions are not exported, so `git` hooks, Makefiles, binaries, `/bin/sh` scripts still run the real command. `command grep` and `/usr/bin/grep` also bypass; a `#!/bin/zsh` script inherits `ZDOTDIR` and is guarded.
- An alternative whose first word is not on `PATH` is still written but loses the `use` form — the prose itself is the refusal.
- Generated guard text is interpolated into a double-quoted zsh string; `\`, `"`, `$`, and backticks must be escaped so a reason cannot break the function.
- State lives in `$XDG_STATE_HOME/opencode/shell-rc/` (default `~/.local/state/opencode/shell-rc/`). Nested interactive/login shells find real rc files through symlinks — do not remove them. An interactive shell must not source `state.zsh` (the shim guards with `! -o interactive`).
- Fail open: if zsh is missing or generation fails, `ZDOTDIR` is not set and the shell behaves as before.
- A guarded `npm` must whitelist `stage` via `~/.config/opencode/shell.zsh` (`npm stage publish` is the publish path).
- Local-directory loading resolves `index.js` beside the package root, not the `exports` map; keep the shim in sync with `dist/`.

Details: [opencode-shell-rc README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-shell-rc#readme) and [schema.md](https://github.com/JeffreyJYZ/cmdcode-tools/blob/main/docs/plan/skills-and-guards/schema.md).
