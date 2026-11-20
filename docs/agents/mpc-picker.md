# mpc --pick — lane notes

Running notes for the interactive picker. User-facing prose lives in `README.md`, the finished report in
`docs/plan/mpc-picker/report.md`.

## Files

- `oc-cmd-compare/src/pick/keys.ts` — pure byte decoder (`decodeKeys(input, final?) -> {keys, rest}`).
- `oc-cmd-compare/src/pick/filter.ts` — `filterRows` (ranking), `applyKey` (state reducer), `PickState`.
- `oc-cmd-compare/src/pick/frame.ts` — `frameLines` (pure layout) + `detailLines` (one-row table via `renderText`).
- `oc-cmd-compare/src/pick/text.ts` — ANSI-aware `visibleLength`/`stripAnsi`/`fitLine` (split out to stay under
  the repo's 150-line cap; `frame.ts` was 169).
- `oc-cmd-compare/src/pick/pick.ts` — the only module that touches tty state (raw mode, alt screen, resize,
  signals) and the only one that prints the chosen row.
- Tests: `oc-cmd-compare/test/unit/pick/{keys,filter,frame}.test.ts`; flag parsing asserts in `test/cli/cli.test.ts`.

## Decisions

- **Ranking shared with `--model`.** `nameTier` lives in `cli/flow/sort.ts`; `matches()`'s invalid-regex fallback
  now calls it, and the picker takes min tier over name+key. Picker input is never compiled as a regex, so `` ` ``
  and `(` are just characters.
- **`q` / `j` / `k` are special only while the query is empty.** A picker whose first keystroke can never be `k`
  is broken for a catalogue containing kimi and qwen; with the query empty, `ini`/`wen` still reach them. Once one
  character is typed, every key is text.
- **Tail columns are fixed width** (6/6/7/4) so the list does not jitter as the query narrows. The cells come from
  the real column registry (`oc-reqmo`, `cc-reqmo`, `win`, `val`), which is what makes an absent side read `—`
  for free.
- **Detail pane is `renderText` itself**, captured by swapping `console.log` for a collector in a `try/finally`,
  then cut at the blank line that separates table and footer. No second formatter. Every `--detail` column,
  `fitColumns` to the terminal; `--od-plan` adds the OD block via `withOd`/`OD_BY_TIER.detail`.
- **ANSI-safe clipping.** A line cut mid-`\u001b[1m` bleeds colour into the next row, so `fitLine` returns the
  coloured line untouched when it fits and the *stripped* + clipped text when it does not.
- **One `restore()`**, idempotent via a `restored` flag, called from `finally`, `SIGTERM`/`SIGINT` handlers and
  `uncaughtException`/`unhandledRejection` handlers. It removes every listener, turns raw mode off, shows the
  cursor, resets SGR and leaves the alternate screen.
- **`process.stdout.columns` can be 0** (`script(1)` reports 0) — 0 is not a width, so the frame falls back to the
  `--width`/120 the caller passed instead of clamping to the 20-column floor.

## Traps

- In raw mode `\n` is not `\r\n`; the pty translated it here, but the frame writes `\n` joined lines only because
  the terminal keeps ONLCR. If a picker ever looks like a staircase, that is the cause.
- `script -q /dev/null` is how this was driven without a human: `(sleep 0.6; printf 'kimi\r') | script -q /dev/null
  bun <probe>`. Feeding bytes before the app starts gets them echoed in cooked mode and dropped — delay first.
- A `pkill -f pick-probe.ts` kills `script` too, closing the pty before the child's restore write lands; kill the
  bun pid only when checking the SIGTERM path.
- `mpc --pick` on a real run costs a live fetch (~18 s here) before the alt screen appears; the probe above
  bypasses `collect()`.

## Gate (this lane)

`bun test` 186 pass / 0 fail · `bun check` clean · `bunx biome lint` clean (one pre-existing schema-version
info) · `bun fmt --check` reports only `src/index.ts`, which another session had already edited (its
`console.error` is split across lines) — not reformatted here.
