# @jeffreyjyz/opencode-shell-rc

Make the opencode agent shell load your zsh aliases and functions.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-shell-rc?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/opencode-shell-rc)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

The shell tool runs `/bin/zsh -c …` in a *non-interactive* shell, which never
reads `~/.zshrc`, so an alias like `gp='git push'` fails in agent shells. This
plugin points every zsh the agent spawns at a `.zshenv` shim that sources the
aliases and functions your interactive shell defines — without paying for
oh-my-zsh, `compinit`, autosuggestions or syntax-highlighting on every command.

## Install

Add it to the `plugins` array in `~/.config/opencode/opencode.json` and restart
(or `/reload`) opencode:

```json
{
  "plugins": ["@jeffreyjyz/opencode-shell-rc"]
}
```

For local development point at the checkout instead (an absolute path is treated
as a local plugin):

```json
{
  "plugins": ["/Users/you/dev/cmdcode-tools/opencode-shell-rc"]
}
```

After `bun run build` the root `index.js` shim loads `dist/`.

## Usage

Nothing to call — once installed, every non-interactive zsh the agent spawns
sources your aliases and functions. Alias and function edits are picked up on the
next command with no restart; a `PATH` change needs an opencode restart.

Drop agent-only zsh into `~/.config/opencode/shell.zsh`, sourced alongside the
generated state.

## How it works

The plugin registers a `shell.create.before` hook. When the shell about to run is
zsh it:

1. lays down `$XDG_STATE_HOME/opencode/shell-rc/` (default
   `~/.local/state/opencode/shell-rc/`) containing:
   - `.zshenv` — the tiny shim zsh reads first;
   - `state.zsh` — the generated aliases and functions;
   - `.zshrc` / `.zprofile` / `.zlogin` — symlinks to your real files so nested
     interactive/login shells still find them;
2. regenerates `state.zsh` **only when the rc changed** (`~/.zshrc`, `~/.zshenv`
   or oh-my-zsh), by running `zsh -ic 'alias -L; typeset -f'` once — zsh's own
   serializer, so every alias and function is captured exactly — then `zcompile`s
   it so sourcing costs ~0.5ms instead of ~10ms;
3. sets `ZDOTDIR` for that command.

Per-command cost is ~0ms: the generated state is sourced from `.zshenv`, and the
rc is re-read only on a change.

## What you get and what you don't

| kept | skipped |
| --- | --- |
| every alias (incl. oh-my-zsh's) | oh-my-zsh startup / theme |
| every shell function | `compinit`, completions |
| an optional `~/.config/opencode/shell.zsh` | autosuggestions, syntax-highlighting |

`PATH` and environment variables are **not** snapshot — the agent shell inherits
the environment opencode was started with. If you add a `PATH` entry to `.zshrc`,
restart opencode for the agent to see it; alias and function edits are picked up
on the next command with no restart.

Non-zsh shells are left completely untouched. If zsh is missing or generation
fails, `ZDOTDIR` is not set and the agent shell behaves exactly as before.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-shell-rc)
- [npm: @jeffreyjyz/opencode-shell-rc](https://www.npmjs.com/package/@jeffreyjyz/opencode-shell-rc)
- [MIT license](LICENSE)
