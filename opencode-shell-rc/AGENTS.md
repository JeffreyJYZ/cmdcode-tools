# AGENTS.md

Repository: `@jeffreyjyz/opencode-shell-rc` — opencode v2 plugin (server half only): makes the agent's non-interactive `zsh` load the user's aliases and functions via a `ZDOTDIR` shim. Sibling of `cmduse`/`mpc`/`reqshape`/`opencode-context` in `~/dev/cmdcode-tools/`; no shared code.

## Layout

```
src/index.ts               server half (v2 `{ id, setup }`): the `shell.create.before` hook
src/shim.ts                the shim: stateDir, shimContent, needsRefresh, prepare, refresh
src/aliases.ts             the alias index: `~/.zshrc`'s own `alias` lines → a block in global AGENTS.md
src/guards.ts              the guard layer: an opted-in name fails in agent shells and names the replacement
src/constants/shell-rc.ts  plugin id, linked rc file names, alias block markers, guard defaults
index.js                   root shim for local-directory plugin loading (see Traps)
```

No TUI half, no runtime dependencies (node builtins only).

## Core rules

- **`ZDOTDIR` is the whole mechanism.** opencode's shell tool runs `zsh -c <command>` non-interactively, which never reads `~/.zshrc`; but zsh _always_ reads `$ZDOTDIR/.zshenv` first. Point `ZDOTDIR` at a shim whose `.zshenv` sources the generated state, so aliases/functions are available before the command string is parsed.
- **Curate with zsh, not a regex — for the shell state.** `state.zsh` comes from `zsh -ic 'alias -L; typeset -f'` — zsh's own serializer, so aliases and functions captured exactly. Never hand-parse `.zshrc` lines _to build the state_.
- **Everything the rc prints during startup must be sliced off — the capture emits `CAPTURE_MARKER` first and keeps only what follows.** `zsh -ic` runs the rc _before_ our command, so a themed prompt's stdout message lands ahead of the serializer output; without the slice it was written into `state.zsh` as if it were a command, and every non-interactive shell died on it (`state.zsh:2: bad pattern: ^[[1mspaceship-prompt^[[0m`). The usual trigger is a broken `fpath`: spaceship's version check calls `is-at-least`, fails to autoload it, and prints `<theme> requires at least zsh v5.2 (you have v5.9)` — a quoted `"$fpath"` in an array assignment (instead of `${fpath[@]}`) collapses the whole path into one element and produces exactly that. Check `print -l $fpath` before blaming the capture. A missing marker keeps the previous state (fail open), never write; `STATE_VERSION` + the `state.zsh.version` sidecar revoke an older capture automatically, so an upgrade repairs a poisoned file without waiting for an rc edit.
- **Refresh on rc change, not per command.** `needsRefresh` compares state file's mtime against `~/.zshrc` / `~/.zshenv` / oh-my-zsh's mtime; the `zsh -ic` generation runs only when that changes. An oh-my-zsh update touching only `lib/`/themes/plugins does NOT refresh (only `oh-my-zsh.sh`'s own mtime is watched), so a snapshot can outlive an omz upgrade.
- **`zcompile` the state after every regeneration.** Sourcing `state.zsh` raw is slow, but `zcompile` writes `state.zsh.zwc` which zsh prefers when newer. Always `rm` old `.zwc` first (it is read-only) and treat compilation as best effort — a missing `.zwc` just falls back to text.
- **State is the _whole interactive environment_, oh-my-zsh included.** Counts far larger than the hand-written `~/.zshrc` are **expected, not a bug** — the snapshot faithfully reproduces what sourcing the rc yields. A smaller payload would mean filtering serializer output to names defined in rc files; current choice deliberately "mirror the interactive shell".
- **The alias index is rc-scoped by design and is the one deliberate text scan.** `src/aliases.ts` reports only aliases whose `alias …` statement is written in `~/.zshrc` itself, because the state capture cannot say where an alias came from and its hundreds of oh-my-zsh entries are useless as guidance. The division of labour: the rc is read as _text_ to learn which statements exist, zsh is asked for _values_ (`zsh -f` + `alias -L`), so quoting stays canonical. An alias defined in a conditional, loop, function or sourced file is not indexed — say so in the README rather than growing a parser.
- **The block in the global AGENTS.md is a managed region, never a rewrite.** `<!-- shell-rc-aliases-begin -->` … `<!-- shell-rc-aliases-end -->` is replaced in place; everything outside it is preserved byte for byte, and the block is appended when absent. Write only when the rendered text differs — opencode watches that file and injects an instruction update on every change, so a rewrite on every shell command would churn the session for nothing.
- **Run the index refresh on the rc's mtime, not per command.** `prepare()` runs before every command; `syncAliases()` costs one `zsh -f` round trip, so it is gated on `refreshIfStale()` having fired **or** the block being absent. `unalias -m '*'` leads the replay script: zsh ships `run-help=man` and `which-command=whence` in every shell, and those two were leaking into the first version of the output as if the user had written them.
- **Fail open.** If zsh is missing or generation throws, `ZDOTDIR` is not set and shell behaves exactly as before. Never fail the shell command. `refreshIfStale` catches missing/failing `zsh` itself and returns false, so `prepare()` still lays down the shim (and the shim then sources nothing). CI runs on Ubuntu with no `zsh`; tests depend on this.
- **PATH/env deliberately not snapshotted.** Agent inherits opencode's start-up environment. Document that a `.zshrc` `PATH` change needs an opencode restart; alias/function changes self-refresh.

- **The guard layer is opt-in, a speed bump, not a jail, and it is agent-shell-only on purpose.** `src/guards.ts` writes `guards.zsh` with a failing function per blocked name, taken from `~/.config/opencode/shell-rc.json`; `DEFAULT_BLOCKED` is **empty**, so a fresh install blocks nothing and no file is written (a config emptied later _removes_ `guards.zsh`, so the shim's `-f` test skips it). What a user opts into is usually `grep`→`rg`, `find`→`fd`, `sed`→`sd`. zsh functions are **not exported**, so `git`, a Makefile, a binary or a `/bin/sh` script still gets the real binary — only the command the model types is shadowed (a `#!/bin/zsh` script is the exception: it inherits the shim's `ZDOTDIR` and is guarded too; measured by running both twins). `command grep` and `/usr/bin/grep` bypass it by design, while `\grep` does **not** (backslash skips aliases, never functions); do not "harden" this into a wrapper that execs the real tool, or the block stops forcing the alternative.
- **A guard whose replacement is not on PATH is not written.** Blocking `find` on a machine without `fd` leaves the agent unable to search at all. A malformed config falls back to the **defaults** — with `DEFAULT_BLOCKED` empty that means no guards; never guess a list. **`cat` is never on the list** — it emits raw bytes, while `bat` reformats (headers, line numbers, decoration), so the blocked command would return something that is not the file. **A guarded `npm` must whitelist `stage`** — `npm stage publish` is the agent's publish path (approval is the human's), and a name-level guard blocks it; override with a `stage`-aware `npm()` in `~/.config/opencode/shell.zsh`, never in the generated guard.

## Traps

- **A captured alias whose name a function also uses makes zsh refuse the definition** (`state.zsh:6231: defining function based on alias 'ls'` / `parse error near '()'`) at `zcompile`/source time — the user's `shell.zsh` pairs `alias ls='eza …'` with an `ls()` fix, and the alias exists when the function is parsed, so the function is silently lost. Harmless per command (the `.zwc` is already built) but noisy on every regeneration; reordering `typeset -f` before `alias -L` would change alias expansion inside function bodies, so it stays.

- **`alias` expansion needs the shim sourced before the `-c` string is parsed.** `ZDOTDIR/.zshenv` is read at startup, before `-c` parsed — why the shim works where appending `source ~/.zshrc` to the command string does not (`-c` string parsed as a unit). Do not "improve" this into a command-string hack.
- **`.zshenv` is always sourced for `zsh -c`; `.zshrc` never is.** That asymmetry is the entire exploit.
- **Generation must pin `ZDOTDIR` to the real `HOME`.** `refreshIfStale` runs `zsh -ic` with `env: { ...process.env, ZDOTDIR: home() }`. Without that, an ambient `ZDOTDIR` — plugin's own shim, inherited by a nested shell or by `bun test` once plugin is live in the agent shell — makes zsh read shim's rc instead of `~/.zshrc`: a feedback loop that regenerates the old state. Same pin on the `zcompile` call. The test deliberately is not the only guard.
- **Do not source the full rc.** `source ~/.zshrc` drags in oh-my-zsh/compinit/autosuggestions, interactive-only and useless in a non-interactive agent shell; `zsh -ic` also emits `(eval):1: can't change option: zle` unless stderr discarded (`2>/dev/null` / `stdio: ignore`).
- **`ZDOTDIR` redirects the lookup for _all_ rc files.** A nested `zsh -i` (or login shell) under the agent would look for `.zshrc`/`.zprofile`/`.zlogin` in shim dir, so those are symlinked back to the real ones. Do not remove the symlinks.
- **An interactive shell must NOT source `state.zsh` — the shim guards it with `! -o interactive`.** The snapshot is of a _loaded_ interactive shell, so it carries prompt/theme functions (`spaceship_*`, `add-zle-hook-widget`) but not the state those need (each section file's top-level `SPACESHIP_*` config vars; `zstyle zle-hook types`). Pre-defined in a fresh interactive shell they silently break the prompt: spaceship's `load_sections` sees `spaceship::defined` true for every section and sources no section file → all `SPACESHIP_*_COLOR`/`_ORDER` unset → `%F{}` emits `\e[30m`, so the whole prompt renders black (invisible on a dark background), and the empty `SPACESHIP_PACKAGE_ORDER` makes `for manager in "${…[@]}"` run once with an empty element → `command not found: spaceship_package::`; zsh-syntax-highlighting's `_zsh_highlight__function_callable_p add-zle-hook-widget` also succeeds, so it skips the `autoload` and calls the captured copy with no `hooktypes` → `Usage: add-zle-hook-widget … / Valid hooks are:` (empty list). Interactive shells read the symlinked `.zshrc` and get the real environment, so nothing is lost by skipping the snapshot.
- **Hook mutability.** `shell.create.before` receives the live `invocation` object; mutating `event.env` is honoured because the spawn reads `invocation.env` afterwards (`packages/core/src/shell.ts`). Hook callback may be async but mutation is synchronous here.
- **PTY/terminal path is a different service** (`experimental.persistentPty`) and is _not_ covered by this hook — only `Shell.create` callers (shell tool, session shell, server shell handler) are.
- **`biome check .` aborts on a nested root configuration when a `.delta/` directory is present**; this repo's `biome.json` excludes `**/.delta`.
- **Local-directory plugins resolve `index`/`server`/`tui` beside the package root, not the `exports` map.** So repo ships a root `index.js` shim that re-exports `dist/`; npm installs use `exports`. Keep shim in sync.
- **Bare `ls` (and `ls -la`) can print NOTHING in an agent shell — that is the shell, not the plugin.** When `ls` is an `eza` alias (`ls='eza --icons=always'`), `eza` with no path operand reads file names from **stdin**; the agent shell's stdin is empty, so it exits 0 with no output (interactively a tty makes it list the cwd, which is why the alias looks fine). Fix in the **escape hatch**, not the plugin: a `ls()` in `~/.config/opencode/shell.zsh` that `unalias ls` and appends `.` when no argument is a path operand (the shim sources that file for agent shells only). Do NOT push this into the plugin's generated shim — it would need to override every user's alias and sort flags from operands, changing behavior for all installs.

## Tests

Hermetic: every test points `HOME` and `XDG_STATE_HOME` at a temp dir and writes a fake `.zshrc`, so real user state never touched. The alias-resolution test (and zsh half of the hook test) is skipped when `zsh` absent. The interactive-guard test overwrites `state.zsh` with a marker and `rm`s its `.zwc` first: `zsh` prefers a `.zwc` that is not older than the source, and `zcompile` lands in the same mtime second, so appending to `state.zsh` alone is silently ignored. Restore saved variables through `restoreEnv` in `test/helpers.ts`: `process.env.X = undefined` stores the string `"undefined"`, which made the alias index write `undefined/opencode/AGENTS.md` into the package directory for every later test in the process.

```sh
bun install
bun test
bun check
bun fmt --check  # verify formatting
bunx biome lint  # verify linting
bun run build
```

## Publishing (NEVER without explicit go)

Same policy as sibling repos: local commits only until user says push. Publishing from this account must go through `npm stage publish` + user's `npm stage approve` — a bare `npm publish` leaves ghost versions (see the root `AGENTS.md`). Version this package independently. After a publish, opencode's per-package install cache can lag npm: `npm cache clean`, remove `~/.cache/opencode/npm/@jeffreyjyz/opencode-shell-rc@latest`, then user restarts. **Never restart or reload opencode yourself.**

See `opencode-context/AGENTS.md` for the `E401`/dead-`.npmrc`-token trap on `npm stage publish` (same account).

Note: `npm stage publish` leaves a `0.0.0-stage` version in the packument. It is the staging placeholder, not a ghost version — after `npm stage approve` the real version becomes `latest` and both entries appear in `versions`. Verify with the raw packument (`curl -sS https://registry.npmjs.org/@jeffreyjyz%2Fopencode-shell-rc`), not `npm view` — npm's local cache can lag and briefly report `0.0.0-stage` as `latest` even after a successful publish.
