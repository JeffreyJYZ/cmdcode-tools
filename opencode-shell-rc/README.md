# @jeffreyjyz/opencode-shell-rc

Make the opencode agent shell load your zsh aliases and functions.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-shell-rc?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/opencode-shell-rc) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

The shell tool runs `/bin/zsh -c …` in a *non-interactive* shell, which never reads `~/.zshrc`, so an alias like `gp='git push'` fails in agent shells. This plugin points every zsh the agent spawns at a `.zshenv` shim that sources the aliases and functions your interactive shell defines — without paying for oh-my-zsh, `compinit`, autosuggestions or syntax-highlighting on every command.

## Install

Add it to the `plugins` array in `~/.config/opencode/opencode.json` and restart (or `/reload`) opencode:

```json
{
  "plugins": ["@jeffreyjyz/opencode-shell-rc"]
}
```

For local development point at the checkout instead (an absolute path is treated as a local plugin):

```json
{
  "plugins": ["/Users/you/dev/cmdcode-tools/opencode-shell-rc"]
}
```

After `bun run build` the root `index.js` shim loads `dist/`.

## Usage

Nothing to call — once installed, every non-interactive zsh the agent spawns sources your aliases and functions. Alias and function edits are picked up on the next command with no restart; a `PATH` change needs an opencode restart.

Drop agent-only zsh into `~/.config/opencode/shell.zsh`, sourced alongside the generated state.

## How it works

The plugin registers a `shell.create.before` hook. When the shell about to run is zsh it:

1. lays down `$XDG_STATE_HOME/opencode/shell-rc/` (default `~/.local/state/opencode/shell-rc/`) containing:
   - `.zshenv` — the tiny shim zsh reads first;
   - `state.zsh` — the generated aliases and functions;
   - `.zshrc` / `.zprofile` / `.zlogin` — symlinks to your real files so nested interactive/login shells still find them;
2. regenerates `state.zsh` **only when the rc changed** (`~/.zshrc`, `~/.zshenv` or oh-my-zsh), by running `zsh -ic 'alias -L; typeset -f'` once — zsh's own serializer, so every alias and function is captured exactly — then `zcompile`s it so sourcing costs ~0.5ms instead of ~10ms;
3. sets `ZDOTDIR` for that command.

Per-command cost is ~0ms: the generated state is sourced from `.zshenv`, and the rc is re-read only on a change.

## What you get and what you don't

| kept | skipped |
| --- | --- |
| every alias (incl. oh-my-zsh's) | oh-my-zsh startup / theme |
| every shell function | `compinit`, completions |
| an optional `~/.config/opencode/shell.zsh` | autosuggestions, syntax-highlighting |

`PATH` and environment variables are **not** snapshot — the agent shell inherits the environment opencode was started with. If you add a `PATH` entry to `.zshrc`, restart opencode for the agent to see it; alias and function edits are picked up on the next command with no restart.

Non-zsh shells are left completely untouched. If zsh is missing or generation fails, `ZDOTDIR` is not set and the agent shell behaves exactly as before.

## The alias index

The agent shell *has* your aliases, but the model does not know their names — so it types `bun` where `b` would do. The plugin therefore mirrors the aliases **you wrote in `~/.zshrc`** into the bottom of the global `~/.config/opencode/AGENTS.md`, between `<!-- shell-rc-aliases-begin -->` and `<!-- shell-rc-aliases-end -->`:

```markdown
<!-- shell-rc-aliases-begin -->
## Shell aliases (auto-generated from ~/.zshrc)

- `b` = `bun`
- `gs` = `git status`
- `ls` = `eza --icons=always`
<!-- shell-rc-aliases-end -->
```

Only `alias …` statements in `~/.zshrc` itself are indexed — the hundreds of aliases oh-my-zsh adds stay out, and so do zsh's two built-in defaults (`run-help`, `which-command`). The values are still zsh's own: the extracted lines are replayed in a clean `zsh -f` and read back with `alias -L`, so quoting comes out canonical.

Behaviour worth knowing:

- **Idempotent.** The block is rewritten only when its content changes, so an unchanged rc leaves `AGENTS.md`'s mtime alone — opencode watches that file and would otherwise inject an instruction update for nothing.
- **Yours stays yours.** Everything outside the markers is preserved byte for byte; the block is appended when the markers are absent.
- **Not exhaustive by design.** An alias defined inside a conditional, a loop, a function, or a sourced file is not indexed — the rc is read as text for *where*, zsh is asked only for *what*.
- **Always present.** If the block is deleted by hand, the next shell puts it back.

## Blocked commands

An agent that learned `grep` on another machine will keep typing it no matter what its instructions say. The plugin therefore shadows a small list of habit commands with a **function that fails and names the right tool**:

```console
$ grep -r TODO src
grep is blocked in agent shells — use rg
$ echo $?
127
```

Defaults are `find` → `fd`, `grep` → `rg` and `sed` → `sd` (the message also names `read`, since `sed -n 'a,bp'` is a range read with no `sd` equivalent). Override them in `~/.config/opencode/shell-rc.json`:

```json
{
  "blocked": {
    "find": "fd",
    "grep": "rg",
    "ack": "rg"
  }
}
```

`cat` is deliberately never on that list: it emits raw bytes, while `bat` reformats (headers, line numbers, decoration), so the output a pipeline or an agent reads would no longer be the file.

Three properties are deliberate:

- **Agent shells only.** zsh functions are not exported, so a real script, a `git` hook, a Makefile or any binary that shells out still runs the real `grep`. What changes is only what the model types into the shell tool.
- **Skipped when the replacement is missing.** Blocking `find` on a machine without `fd` would leave the agent with no way to search, so a guard whose replacement is not on `PATH` is not written at all.
- **Not a jail.** `command grep`, `/usr/bin/grep` and `\grep` all still work — the guard is a speed bump long enough for the model to reconsider, not a security boundary. A malformed config falls back to the defaults rather than to no guards, because "the agent quietly went back to grep" is a much quieter failure than a broken shell.

The user's escape hatch still wins: `~/.config/opencode/shell.zsh` is sourced after the guards, so a single machine can undo one.

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
