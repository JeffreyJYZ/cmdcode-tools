# AGENTS.md

Repository: `@jeffreyjyz/opencode-shell-rc` — opencode v2 plugin (server half only): makes the agent's non-interactive `zsh` load the user's aliases and functions via a `ZDOTDIR` shim. Sibling of `cmduse`/`mpc`/`reqshape`/`opencode-context` in `~/dev/cmdcode-tools/`; no shared code.

## Layout

```
src/index.ts               server half (v2 `{ id, setup }`): the `shell.create.before` hook
src/shim.ts                the shim: stateDir, shimContent, needsRefresh, prepare, refresh
src/constants/shell-rc.ts  plugin id and linked rc file names
index.js                   root shim for local-directory plugin loading (see Traps)
```

No TUI half, no runtime dependencies (node builtins only).

## Core rules

- **`ZDOTDIR` is the whole mechanism.** opencode's shell tool runs `zsh -c <command>` non-interactively, which never reads `~/.zshrc`; but zsh *always* reads `$ZDOTDIR/.zshenv` first. Point `ZDOTDIR` at a shim whose `.zshenv` sources the generated state, so aliases/functions are available before the command string is parsed.
- **Curate with zsh, not a regex.** `state.zsh` comes from `zsh -ic 'alias -L; typeset -f'` — zsh's own serializer, so aliases and functions captured exactly. Never hand-parse `.zshrc` lines.
- **Refresh on rc change, not per command.** `needsRefresh` compares state file's mtime against `~/.zshrc` / `~/.zshenv` / oh-my-zsh's mtime; the `zsh -ic` generation runs only when that changes.
- **`zcompile` the state after every regeneration.** Sourcing `state.zsh` raw is slow, but `zcompile` writes `state.zsh.zwc` which zsh prefers when newer. Always `rm` old `.zwc` first (it is read-only) and treat compilation as best effort — a missing `.zwc` just falls back to text.
- **State is the *whole interactive environment*, oh-my-zsh included.** Counts far larger than the hand-written `~/.zshrc` are **expected, not a bug** — the snapshot faithfully reproduces what sourcing the rc yields. A smaller payload would mean filtering serializer output to names defined in rc files; current choice deliberately "mirror the interactive shell".
- **Fail open.** If zsh is missing or generation throws, `ZDOTDIR` is not set and shell behaves exactly as before. Never fail the shell command. `refreshIfStale` catches missing/failing `zsh` itself and returns false, so `prepare()` still lays down the shim (and the shim then sources nothing). CI runs on Ubuntu with no `zsh`; tests depend on this.
- **PATH/env deliberately not snapshotted.** Agent inherits opencode's start-up environment. Document that a `.zshrc` `PATH` change needs an opencode restart; alias/function changes self-refresh.

## Traps

- **`alias` expansion needs the shim sourced before the `-c` string is parsed.** `ZDOTDIR/.zshenv` is read at startup, before `-c` parsed — why the shim works where appending `source ~/.zshrc` to the command string does not (`-c` string parsed as a unit). Do not "improve" this into a command-string hack.
- **`.zshenv` is always sourced for `zsh -c`; `.zshrc` never is.** That asymmetry is the entire exploit.
- **Generation must pin `ZDOTDIR` to the real `HOME`.** `refreshIfStale` runs `zsh -ic` with `env: { ...process.env, ZDOTDIR: home() }`. Without that, an ambient `ZDOTDIR` — plugin's own shim, inherited by a nested shell or by `bun test` once plugin is live in the agent shell — makes zsh read shim's rc instead of `~/.zshrc`: a feedback loop that regenerates the old state. Same pin on the `zcompile` call. The test deliberately is not the only guard.
- **Do not source the full rc.** `source ~/.zshrc` drags in oh-my-zsh/compinit/autosuggestions, interactive-only and useless in a non-interactive agent shell; `zsh -ic` also emits `(eval):1: can't change option: zle` unless stderr discarded (`2>/dev/null` / `stdio: ignore`).
- **`ZDOTDIR` redirects the lookup for *all* rc files.** A nested `zsh -i` (or login shell) under the agent would look for `.zshrc`/`.zprofile`/`.zlogin` in shim dir, so those are symlinked back to the real ones. Do not remove the symlinks.
- **Hook mutability.** `shell.create.before` receives the live `invocation` object; mutating `event.env` is honoured because the spawn reads `invocation.env` afterwards (`packages/core/src/shell.ts`). Hook callback may be async but mutation is synchronous here.
- **PTY/terminal path is a different service** (`experimental.persistentPty`) and is *not* covered by this hook — only `Shell.create` callers (shell tool, session shell, server shell handler) are.
- **`biome check .` aborts on a nested root configuration when a `.delta/` directory is present**; this repo's `biome.json` excludes `**/.delta`.
- **Local-directory plugins resolve `index`/`server`/`tui` beside the package root, not the `exports` map.** So repo ships a root `index.js` shim that re-exports `dist/`; npm installs use `exports`. Keep shim in sync.

## Tests

Hermetic: every test points `HOME` and `XDG_STATE_HOME` at a temp dir and writes a fake `.zshrc`, so real user state never touched. The alias-resolution test (and zsh half of the hook test) is skipped when `zsh` absent.

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Publishing (NEVER without explicit go)

Same policy as sibling repos: local commits only until user says push. Publishing from this account must go through `npm stage publish` + user's `npm stage approve` — a bare `npm publish` leaves ghost versions (see `cmduse/AGENTS.md`). Version this package independently. After a publish, opencode's per-package install cache can lag npm: `npm cache clean`, remove `~/.cache/opencode/npm/@jeffreyjyz/opencode-shell-rc@latest`, then user restarts. **Never restart or reload opencode yourself.**

See `opencode-context/AGENTS.md` for the `E401`/dead-`.npmrc`-token trap on `npm stage publish` (same account).

Note: `npm stage publish` leaves a `0.0.0-stage` version in the packument. It is the staging placeholder, not a ghost version — after `npm stage approve` the real version becomes `latest` and both entries appear in `versions`. Verify with the raw packument (`curl -sS https://registry.npmjs.org/@jeffreyjyz%2Fopencode-shell-rc`), not `npm view` — npm's local cache can lag and briefly report `0.0.0-stage` as `latest` even after a successful publish.
