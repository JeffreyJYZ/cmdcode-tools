# `mpc pick` — report

Lane: `oc-cmd-compare` (`@jeffreyjyz/mpc`). No version bump, no tag, no publish. One tree, no worktree.

## Flag

`--pick` — a full-screen, type-to-narrow search over the rows the run already built.

- Declared in `src/cli/parse/cac.ts`, whitelisted as a boolean in `src/constants/cli.ts` (`KNOWN`, not `VALUED`),
  mapped in `src/cli/parse/map.ts`, typed as `Options.pick`, documented in `src/view/text/help.ts`
  (`COLUMN_HELP` plus the shared `PICK_KEYS` hint the picker footer renders) and in `README.md` (usage line,
  keys table, and an "Interactive picker" section).
- `--help` lists it:

```
  --pick                  interactive search: type to narrow, enter prints the highlighted row (TTY only)
```

**It only replaces the table when it can work.** `pickable(options)` requires `process.stdout.isTTY &&
process.stdin.isTTY` and refuses `--json`, any `--format` other than `table`, `--usage`, `--check` and
`--print-config`. Verified non-TTY (piped) output is byte-identical to today:

```
$ bun run src/index.ts --no-config --pick | head -3
                              │      OpenCode Go       │    CommandCode GOAT    │
MODEL                         │ allow  mo     $/1K     │ allow  mo     $/1K     │ ability  tps   WIN      COST  VAL
──────────────────────────────┼────────────────────────┼────────────────────────┼──────────────────────────────────

$ bun run src/index.ts --no-config --pick --json | head -3
{
  "workloads": {
    "oc-go": {
```

The plugin's pinned `mpc --json --shape off` contract is untouched: `--json` leaves before the branch, and the
picker never fetches anything (built from `collect()`'s rows, so no extra source request).

## Module split

| file                            | responsibility                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/pick/keys.ts`              | pure decoder: bytes → keys, with an unfinished escape returned as `rest`                     |
| `src/pick/filter.ts`            | `filterRows` ranking, `applyKey` state reducer, `PickState`                                  |
| `src/pick/frame.ts`             | pure `frameLines` layout + `detailLines` (one-row table from the normal renderer)            |
| `src/pick/text.ts`              | ANSI-aware `visibleLength`/`stripAnsi`/`fitLine` (split out; `frame.ts` was over 150 lines)  |
| `src/pick/pick.ts`              | the only tty code: raw mode, alternate screen, resize, signals, printing the chosen row      |
| `src/cli/run.ts`                | the branch and nothing else (one import, three lines)                                        |
| `src/cli/flow/sort.ts`          | `nameTier`, shared by `--model`'s invalid-regex fallback and the picker                      |

`run.ts`:

```ts
const limit = options.width ?? process.stdout.columns ?? 120;
if (pickable(options)) {
	return pickRows(result, meta, limit);
}
```

### Detail pane reuses the renderer

`detailLines(row, meta, width)` calls `renderText([row], meta, fitColumns([row], DETAIL_COLUMNS, width).ids)` —
with `withOd(DETAIL_COLUMNS, OD_BY_TIER.detail)` when `--od-plan` is on — capturing `console.log` in a
`try/finally` and cutting at the blank line `renderText` prints between table and footer. No second formatter, and
the `—` cells, tints, COST/VAL colours and `--detail` column set are the table's own. Enter prints exactly those
lines after the terminal is restored, so the chosen row can be copied.

## Keys handled

| key                                        | action                                                     |
| ------------------------------------------ | ---------------------------------------------------------- |
| printable ASCII (`0x20`–`0x7e`)             | append to the query, re-rank, reset the highlight to the top |
| `Backspace` (`0x7f`), `Ctrl-H` (`0x08`)     | remove the last query character                            |
| `↑` / `↓` (`\x1b[A` / `\x1b[B`)             | move the highlight, clamped to the list                     |
| `↑` / `↓` in SS3 form (`\x1bOA` / `\x1bOB`) | same (application-cursor terminals)                        |
| `j` / `k` while the query is empty          | move down / up                                             |
| `Enter` (`\r` or `\n`)                      | choose the highlighted row (no-op on an empty list)         |
| `Esc`                                       | quit, exit 0                                               |
| `q` while the query is empty                | quit, exit 0                                               |
| `Ctrl-C` (`0x03`)                           | quit, exit 0                                               |
| `Ctrl-D` (`0x04`)                           | quit, exit 0                                               |
| any other escape/control sequence           | ignored (never read as "Esc then A")                        |

An escape split across reads is buffered (`rest`) and reassembled; a lone `\x1b` is only Esc after a 25 ms flush
with `final = true`. `q`/`j`/`k` are special **only while the query is empty** — otherwise a catalogue with kimi
and qwen in it could never be searched by their first letter; `imi`/`wen` still reach them, and after one
character every key is text.

Ranking: case-insensitive substring over the model name and its canonical key, never a regex. Tier 0 = the name or
key starts with the query, tier 1 = it starts a word (` `, `-`, `_`, `/`), tier 2 = it occurs mid-word; ties keep
the `--metric` order, and an empty query is every row in that order.

## The frame

Fixed fixture, colour off, `query = "flash"`, two matches of four rows, one side absent in the fixture set.
Produced by `frameLines` + `detailLines` at the two widths (the same code the terminal path draws).

At **80** columns:

```
mpc pick · 2 of 4 models
query: flash█
────────────────────────────────────────────────────────────────────────────────
▸ DeepSeek V4.1 Flash                               55.1K   55.1K  tie        83
  GLM-5.3 Flash-X                                   55.1K   55.1K  tie        83
────────────────────────────────────────────────────────────────────────────────
                    │    OpenCode Go     │  CommandCode GOAT  │                …
MODEL               │ allow  mo     $/1K │ allow  mo     $/1K │ ability  WIN  C…
────────────────────┼────────────────────┼────────────────────┼────────────────…
DeepSeek V4.1 Flash │   $20  55.1K  $1.8 │   $20  55.1K  $1.8 │    39.5  tie   …
↑↓/jk move · enter print · esc q quit · ⌫ edit
```

At **120** columns:

```
mpc pick · 2 of 4 models
query: flash█
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
▸ DeepSeek V4.1 Flash                                                                       55.1K   55.1K  tie        83
  GLM-5.3 Flash-X                                                                           55.1K   55.1K  tie        83
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                    │    OpenCode Go     │  CommandCode GOAT  │
MODEL               │ allow  mo     $/1K │ allow  mo     $/1K │ ability  tps  WIN  COST  VAL
────────────────────┼────────────────────┼────────────────────┼─────────────────────────────
DeepSeek V4.1 Flash │   $20  55.1K  $1.8 │   $20  55.1K  $1.8 │    39.5  165  tie    93   83
↑↓/jk move · enter print · esc q quit · ⌫ edit
```

Width comes from `process.stdout.columns` (a 0-column pty falls back to `--width`/120, never to the 20-column
floor); `SIGWINCH` redraws through `stdout.on("resize")`. Long names clip with `…` via the new shared
`clip()` in `src/view/text/format.ts`. The detail block is `fitColumns`-trimmed like the table, so at 80 columns
its undroppable columns (model, WIN, COST) still slightly exceed the frame and are cut with `…` — the same
limitation the static table has at that width. A row missing a side shows `—` in those cells because the cells are
the column registry's own values.

## Live terminal check

Driven through a pty (`script -q /dev/null`), no human needed:

- real CLI, `--pick`, typed `deepseek` + `Enter` → the highlighted row's detail table printed after teardown;
- type-to-narrow with the real catalogue (`77 of 77` → the DeepSeek matches) and `—` on one-sided rows;
- `↓`/`j` + `Enter` → picked the second row; `q`, `Esc`, `Ctrl-C`, `Ctrl-D`, and a bare `Esc` after the 25 ms
  flush → exit 0 with nothing printed;
- `SIGTERM` → the terminal-restore sequence (`ESC[?25h ESC[0m ESC[?1049l`) still written, then exit.

Every path ends with raw mode off (`process.stdin.isRaw === false` reported after return).

## Tests added

32 new tests (93 assertions) across three pure test files (`test/unit/pick/`), plus a flag-parsing test:

- `keys.test.ts` (8 tests) — text/space/backtick decoding, backspace both forms, CR and LF, Ctrl-C, Ctrl-D, both
  arrow encodings, unknown CSI ignored, **one-byte-at-a-time arrow**, incomplete escape waiting then completing,
  `final` flush making a lone escape Esc, and Esc-then-letter keeping the letter.
- `filter.test.ts` (13 tests) — empty query identity, case-insensitive substring over name and key, key-only hit,
  prefix > word-start > mid-word ranking with metric order as tiebreak, space/backtick/paren never throwing, plus
  the reducer: typing resets the highlight, backspace edits, up/down clamp, Enter chooses / no-ops on empty, Esc &
  Ctrl-D quit, `j`/`k` browse only while empty, and `q` quits only while empty.
- `frame.test.ts` (11 tests) — header/query/rule/selected marker, `—` and `CC only` on a one-sided row, every line
  within 80 and 120, long name clipped with `…` when narrow and whole when wide, the detail block under its own
  rule and counted in the height, "no model matches", a deep selection scrolling the window, the query echoed with
  its cursor; `detailLines` is the table without the footer, drops columns to fit, and a clipped coloured line
  loses its colour instead of bleeding it.
- `test/cli/cli.test.ts` — `parseArgs([]).pick === false`, `parseArgs(["--pick"]).pick === true`.

No test needs a tty: the frame builder and the state reducer are tested directly.

## Gate

```
$ bun test
mpc/0.1.15 darwin-arm64 bun-v26.3.0

 186 pass
 0 fail
 586 expect() calls
Ran 186 tests across 30 files. [647.00ms]

$ bun check
✓ No type errors in 118 files [16.49ms]

$ bun fmt --check
src/index.ts
1 file needs formatting. Run bun fmt to fix it.

$ bunx biome lint

Checked 124 files in 18ms. No fixes applied.
Found 1 info.
```

The biome line is the pre-existing `biome.json` schema-version info (schema 2.6.3 vs CLI 2.5.14), and the
`bun fmt --check` failure is `src/index.ts` only — a file another session had already edited before this lane
started (`git diff` shows a line-wrapped `console.error`). It was deliberately not reformatted: that edit is not
this lane's work. Every file this lane touched passes `bun fmt --check`.

## Not done

No version bump, tag or publish (owner's call). `~/.config/opencode/AGENTS.md` and every repo `AGENTS.md`
untouched. Running notes in `docs/agents/mpc-picker.md`.
