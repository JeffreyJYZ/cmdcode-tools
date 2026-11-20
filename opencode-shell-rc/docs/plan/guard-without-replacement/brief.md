# Brief — a guard with no replacement on PATH

Repo: `~/dev/cmdcode-tools/opencode-shell-rc`. Read `AGENTS.md` first.

## Why

`~/.config/opencode/shell-rc.json` is the literal place a block belongs, but one case is
impossible today: a command that must be blocked outright, with no substitute binary. `tccutil` is
that case — `tccutil reset <service>` deletes every grant for a service with no undo, and it has no
grant verb, so nothing on PATH is an alternative; the action belongs to the human.

`renderGuards` skips any entry whose first word is not installed:

```ts
const binary = replacement.split(/\s+/)[0];
if (!binary || !installed(binary)) continue;
```

So `"tccutil": "TCC changes are human-only; ask the user"` silently blocks nothing.

## What to build

Keep the installed-replacement behaviour exactly as it is. Add the missing case:

- replacement's first word is installed → today's line, `… is blocked in agent shells — use <replacement>`
- replacement's first word is NOT installed → still write the guard, message
  `… is blocked in agent shells — <replacement>` (no `use`), because the text is already a sentence

That makes the config self-describing:

```json
"tccutil": "TCC changes are human-only; ask the user"
```

Keep `DEFAULT_BLOCKED` empty. Keep the `cat` exclusion and the `validName` check.

## The refresh must not need a restart

`syncGuards` runs from `prepare()`, but a JSON edit that does not change `state.zsh` must still
regenerate `guards.zsh` on the next command. Check how `syncGuards` is gated in `src/shim.ts`; if it
needs the config mtime, add it, and prove the next shell command picks up a JSON edit with no
opencode restart.

## Tests

`bun test` covers `renderGuards` both ways: installed replacement keeps `use`, missing replacement
keeps the sentence and still writes the function; an entry with only whitespace is skipped; `cat`
stays excluded. Add a case asserting a JSON edit reaches `guards.zsh` without a state refresh.

## Finish

1. Edit the real config `~/.config/opencode/shell-rc.json`: add
   `"tccutil": "TCC changes are human-only; ask the user"` beside the existing entries.
2. Regenerate and prove it: `~/.local/state/opencode/shell-rc/guards.zsh` contains a `tccutil`
   function, and a fresh agent shell answers `tccutil`, `tccutil reset ScreenCapture`,
   `command tccutil`, `\tccutil` and `sh -c tccutil` with the refusal — never by running the real
   binary and never with a reset.
3. `bun test`, `bun check src`, `bun fmt --check src` all green.
4. Add one bullet to that repo's `AGENTS.md`: a guard with no installed replacement is written with
   its own sentence, no `use`.
5. Report to `docs/plan/guard-without-replacement/report.md`: the diff summary, the five refusals
   with their exact output, and the gate output.

Do not touch `~/.config/opencode/shell.zsh` or the shim at
`~/.local/state/opencode/agent-bin/tccutil` — the controller removes those once this path is proven.
Do not run `/usr/bin/tccutil`, `sudo tccutil`, or any command that changes TCC.
