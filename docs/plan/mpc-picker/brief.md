# Lane: `mpc pick` — full-screen interactive model search

Repo: `/Users/jyz/dev/cmdcode-tools/oc-cmd-compare` (package `@jeffreyjyz/mpc`, bin `mpc`).
Dependencies today: `cac` only. Do not add a TUI library — hand-roll raw mode with the ANSI sequences
already used for the table. If you conclude a dependency is unavoidable, stop and say so instead.

## What the user asked for

An in-CLI interactive search: a full-screen list of the models, typing any fragment (not an exact name)
narrows it on every keystroke, and the highlighted model shows its full row — every column for the things
that model has. Enter prints the selected row, Esc or Ctrl-C quits cleanly.

## Where this has to plug in

- Entry: `src/index.ts` → `src/cli/run.ts` `run(argv)`.
- Rows are already built there: `sortRows(selectRows(rows, options), options.metric, options.asc)`, typed
  `CompareRow[]` (`src/types.ts`).
- The static table prints through `renderText(result, meta, fitted.ids, fitted.dropped)` in
  `src/view/render.ts`; `meta` is assembled in `run.ts`, and `resolveColumns(options)` gives the column
  list (`src/cli/flow/columns.ts`). One row's full detail is the same renderer with a one-row slice and
  every column `--detail` would give — reuse it, do not write a second formatter.
- Flags are parsed by `cac` in `src/cli/parse/cac.ts`, validated in `src/cli/parse/validate.ts`, mapped to
  `Options` in `src/cli/parse/map.ts` (`src/cli/options.ts` holds the type). Add `--pick` there, and list
  it in `src/view/text/help.ts` as well as `--help`.
- The existing name matcher is `matches()` in `src/cli/flow/sort.ts` — case-insensitive regex over
  `row.name` and `row.key`, falling back to substring on an invalid pattern. Share it (or a superset) so
  the picker and `--model` never disagree about what matches.

## Hard requirements

1. **Never enter the picker when it cannot work.** Require `process.stdout.isTTY && process.stdin.isTTY`
   and none of `--json`, `--format json|csv|md`, `--usage`, `--check`, `--print-config`. Non-TTY must print
   the normal table exactly as today. This is what keeps the plugin's `mpc --json --shape off` contract and
   every agent caller untouched.
2. **Always restore the terminal.** `setRawMode(true)` inside a `try/finally` that restores raw mode off,
   shows the cursor and emits a reset SGR. A crash, a Ctrl-C, an unhandled rejection or an `SIGTERM` must
   all leave the shell usable — a terminal stuck in raw mode is the worst possible outcome of this feature.
3. **Keys**: printable chars narrow; Backspace edits; Up/Down *and* `j`/`k` move; Enter prints; `q`, Esc,
   Ctrl-C exit 0; Ctrl-D exits 0. Arrow escape sequences arrive as three bytes and may be split across
   reads — buffer them, do not treat `\x1b[A` as "Esc then A". Split the decoder into a pure function and
   unit-test it, including a sequence delivered one byte at a time.
4. **Filtering is not exact-name.** Case-insensitive substring over name and key is the floor; rank so a
   name that starts with the query sorts above one that contains it mid-word, and keep the current
   `--metric` order as the tiebreak. Typing `` ` `` or a space must not throw. Empty query = every row.
5. **Layout**: width from `process.stdout.columns` (fall back 120). Redraw on `SIGWINCH`. Long names clip
   with `…` the way `src/view/text/format.ts` already does. Show the query on one line, the list, and the
   highlighted model's full row underneath; a row that has no OpenCode or CommandCode side must read `—`
   in those cells, exactly like the table.
6. **Determinism**: the picker must not fetch anything. Build it from the rows `collect()` already
   produced, so it costs no extra source request.

## Structure

The repo's rule is one responsibility per file and a 200-line cap (tests included). Put the picker in its
own module — `src/pick/keys.ts`, `src/pick/filter.ts`, `src/pick/frame.ts`, `src/pick/pick.ts` — with
`pick.ts` the only part that touches tty state. `run.ts` gains the branch and nothing else.

## Tests and gate

`bun test`, `bun check`, `bun fmt --check`, `bunx biome lint`. Unit-test the pure three modules: key
decoder (including split escapes and Ctrl-C), filter ranking, and frame output for a fixed width — assert
on rendered strings, not on ANSI-on/off guesses. Do not write a test that needs a tty; test the frame
builder and the state reducer instead.

Update `README.md` in the same edit (`--pick` in the Usage block, one line on what it does) — the README is
the canonical docs page and a user-visible flag that is undocumented is not finished.

## Do not

- Do not bump the version, tag, or publish. The owner releases.
- Do not touch `~/.config/opencode/AGENTS.md`, any repo `AGENTS.md`, or another session's files.
- No worktree — one tree only. Do not run `grep`/`find`/`sed`; use `rg` and `fd` with explicit paths.
- Do not change `--json`, `--format`, `--usage`, `--check` output or the `mpc --json --shape off` contract
  the plugin sidebar consumes — it is a pinned consumer contract.
- Do not truncate the work or stop early to report.

Write your report to `docs/plan/mpc-picker/report.md` (in the repo root, `cmdcode-tools/docs/plan/mpc-picker/`):
the flag you added, the module split, every key handled, what the frame looks like at 80 and 120 columns,
the tests you added, and the exact gate output. Keep running notes in `docs/agents/mpc-picker.md`.

DO NOT WASTE TURNS: do as much as possible in one turn/response — batch every independent call, chain
dependent steps, never yield between them. Run builds and tests in the foreground and wait for them.
