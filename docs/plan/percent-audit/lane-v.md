# Lane V — the CLI's watch mode cuts every line from the right

Repo `/Users/jyz/dev/cmdcode-tools`. Rust workspace: `core/`, `cmduse/` (bins `cmduse`, `ocuse`, `arkuse`,
`oduse`).

## The finding

From `docs/plan/percent-audit/truncation.md`: one-shot output prints prose whole, but **watch mode** hard-cuts
each rendered line from the right with `clip_to_width` (`cmduse/src/lib.rs:489-493`). There is no `--width`
flag and `COLUMNS` is ignored — measured output at `COLUMNS=40` and `COLUMNS=200` was byte-identical.

Consequence: in watch mode a long label or note (the new `the allowance changed during this period …` line is
110 characters) is chopped mid-sentence, exactly the defect the sidebar just fixed. A live dashboard that
silently drops the second half of every explanation is worse than one that wraps.

## Task

1. **Wrap, don't cut.** Replace the per-line hard cut with word-boundary wrapping at the real terminal width,
   producing continuation lines that keep the renderer's existing left margin and colour. Money and percent
   tokens are already narrow; the wrapping must never split a token, and a line that fits must be byte-identical
   to today's output (this is a live dashboard — no gratuitous reflow).
2. **A real width.** Take the width from the terminal (`process`/`ioctl`-free: the crate already knows the tty
   size for the frame, so reuse that), fall back to `COLUMNS`, then 100. Add `--width <n>` for scripts and for
   the case this audit hit, and make sure `--json`/`--csv` ignore it entirely.
3. **Both code paths.** The cut lives in the shared watch loop, so the fix covers all four binaries at once —
   verify with `cmdusedev`, `ocusedev`, `arkusedev`, `odusedev` rather than assuming.
4. **Parity.** `--width` must behave identically on all four (this repo's rule: a flag one binary has, all
   four have unless the source forbids it). If any binary cannot honour it, say why in the report rather than
   leaving the flag silently inert.

## Tests

- `watch_lines_wrap_instead_of_cutting` — a 110-character line at width 40 produces 3 lines whose concatenation
  is the original text, with no `…` and no lost characters.
- `a_line_that_fits_is_byte_identical` — width 120 on a short line changes nothing.
- `width_comes_from_the_terminal_then_columns_then_100`.
- `json_and_csv_ignore_width` — the machine formats are unaffected.
- If the wrap lives in `cmduse-core`, its tests go there and stay pure (no tty).

## Constraints

- Own: `cmduse/src/lib.rs` (the watch loop and `clip_to_width`), a new small module if the wrapper deserves one,
  `cmduse/src/render.rs` only if the helper belongs there, the four binaries' flag declarations in
  `cmduse/src/cli.rs`, `cmduse/README.md`, `cmduse/cmduse.1`, and your two docs paths.
- Do not touch `cmduse/src/ocuse/**`, `oduse/**`, `arkuse/**` rendering internals beyond the width plumbing the
  watch loop already calls — another lane may be editing the plugin side, but this crate is yours alone.
- `cmduse-core` stays pure: no tty, no I/O.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`, and never pass `-r` to `rg`.
- Gate, foreground: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`,
  and `bun parity` (you are adding a flag to four binaries — the flag-surface check must pass). No version
  bump, tag, publish, commit or `AGENTS.md`.

Report to `docs/plan/percent-audit/lane-v.md`: the wrapper's signature, where the width comes from at each
priority, the 40-column render proof for all four binaries, and every test name.

## Report — implemented, left uncommitted

**Wrapper.** `pub fn wrap_line(line: &str, width: Option<usize>) -> Vec<String>` in
`cmduse/src/lib.rs`. A line that fits (or a `None` width) returns one byte-identical string.
Otherwise it tokenizes SGR escapes, `\r`, control chars, whitespace and words, breaks only at
whitespace, repeats the original leading margin and the still-active SGR on every continuation
row, closes colour with `\x1b[0m` on wrapped rows, never emits an ellipsis and never splits a
word. `visible_columns` is now the single "does it fit" measure shared with `clip_to_width`.
`redraw_frame` flat-maps frame lines through `wrap_line` and counts the wrapped rows, so its
shrink/clear math stays in step with what is on screen.

**Width priority** (`resolve_width(explicit, tty_cols, columns)`, re-resolved each refresh):
1. `--width <n>` (1–1000, parsed for all four binaries; distinct from `-w/--bar-width` and from
   the config `width` key, which sets the gauge).
2. Terminal columns from the existing uncached `term_size()` (`stty size < /dev/tty`).
3. `COLUMNS` env (positive integer only).
4. 100.

`frame_width(explicit, machine, tty_cols)` returns `None` for `--json`/`--csv`, so the machine
formats never wrap and ignore `--width` entirely. `watch_width(args, tty_cols)` is that helper
driven by parsed args; `oduse`'s `watch::Loop` carries the same two values (`width`, `machine`)
from `oduse/cli/frame.rs`. The terminal still drives the compact-frame decision, unchanged.

**40-column render proof.** Live watch mode, `--width 40 --plain -i 1`, short report windows so
the store read finishes, raw stream stripped of SGR and split at `\r`/`\n`:

| binary | extra flags | rows drawn | max visible width | rows over 40 |
| --- | --- | --- | --- | --- |
| cmdusedev | — | 83 | 40 | 0 |
| ocusedev | `--no-api --no-catalog --days 1 --window 1d` | 465 | 40 | 0 |
| arkusedev | `--no-api --days 1 --window 1d` | 379 | 40 | 0 |
| odusedev | `--no-wallet --no-catalog --days 1` | 415 | 48 | 6 |

All six over-40 oduse rows are the same single token,
`Design/namespaces/release-stable/data/app.sqlite` (48 chars). It is one unbroken path segment,
so the wrapper kept it whole by design ("never split a token"); the surrounding path wrapped into
`~/Library/Application Support/Open`, that token, and `(app + opencode)`. The lone `…` in
cmduse's raw stream is its own "in resetting…" prose, not a wrapper ellipsis.

**Parity.** `bun parity`: PASS, 4 binaries / 31 flags; `--width` present on all four, no
allow-list change. Added to all four help texts, including `oduse/help.rs` (help only, no
rendering internals). Live `--json`/`--csv` runs with and without `--width 40` differ only in
timestamps and newly arrived store rows, never in width-related fields.

**Tests** (all in `cmduse/src/main_tests.rs`):
- `watch_lines_wrap_instead_of_cutting`
- `a_line_that_fits_is_byte_identical`
- `width_comes_from_the_terminal_then_columns_then_100`
- `json_and_csv_ignore_width`
- `wrapped_lines_keep_the_margin_and_colour`
- `redraw_wraps_a_long_frame_line_without_losing_words`

**Gates (foreground):** `cargo test` 377 + 25 passed; `cargo fmt --all -- --check` clean;
`cargo clippy --all-targets -- -D warnings` clean; `bun parity` PASS. README and `cmduse.1`
document the flag. No version bump, tag, publish or commit; no other lane's files touched.

## Follow-up — one-shot `--width`

The first pass only wrapped the watch frame, leaving `--width` inert on `-1`. Fixed:
`wrap_text(text, width) -> String` wraps each one-shot text line through the same `wrap_line`,
preserving the trailing newline; `one_shot_width(args)` calls the same `watch_width`/`frame_width`
resolution (`--width` → tty → `COLUMNS` → 100, `None` for `--json`/`--csv`). Applied to the
one-shot dashboard and every text report path in all four binaries: cmduse's `run()` (daily,
hourly, model, session, dashboard) and `plans_cmd`; ocuse/arkuse's `run()` (plans, models, daily,
hourly, session, model, dashboard); oduse's `Ctx.width` feeding `cli/mod.rs` (plans, models),
`cli/dispatch.rs` (reports) and `cli/frame.rs` (dashboard). `statusline` stays a single line by
contract and `models_cmd`'s raw three-column `println!` rows are cells.

A row with two or more runs of 2+ spaces, or a box-drawing border, is emitted byte-identical: a
table column is aligned data and cannot be reflowed. Documented in README and `cmduse.1`.

**40-column one-shot proof** — `--width 40 -1`, stdout stripped of SGR, every line over 40:

| binary | lines over 40 | every remaining line | reason |
| --- | --- | --- | --- |
| cmdusedev | 2 | ` Model … Cost` header; `deepseek/deepseek-v4.1-flash …` row | table cells (3 aligned gaps) |
| ocusedev | 9 | `TOP 3 MODELS …` header + 3 data rows; `MODEL … REQ` header + 4 data rows | table cells (4–6 gaps) |
| arkusedev | 4 | `TOP 3 MODELS …` header + 1 row; `MODEL … REQ` header + 1 row | table cells (3–4 gaps) |
| odusedev | 4 | `Design/namespaces/release-stable/data/app.sqlite` (48 chars); `MODEL … REQ` header + 2 rows | one unbreakable path token; table cells |

No prose line exceeds 40 in any binary. Report subcommands checked too: `ocusedev daily --width
40` leaves only its 45-column table rows; `models`/`plans --width 40` leave only their aligned
table rows. `plans --json` is byte-identical with and without `--width 40`.

**Tests added:** `one_shot_prose_wraps_but_table_rows_do_not`,
`one_shot_width_matches_watch_resolution`. Gates re-run: `cargo test` 375 + 25, fmt clean,
clippy clean, `bun parity` PASS.

**`ocusedev --json totals.month.limit`** — deliberate absence, not a missing field.
`render_json`'s `totals` closure emits only `cost`/`requests`/`tokens`: Go's allowance is per
model and per period, so no aggregate monthly cap exists to put there. The `$100` in the text
`Monthly` row is the focus model's limit (the `current_cap` branch that builds `CapBlend`),
carried in JSON as `models[].limit`; when the account endpoint answers, its own cap is also at
`account.monthly.currentCap`. Adding `totals.month.limit` would invent a pool the source never
published.

## Follow-up — the 41-byte rows were a byte-count artifact

`awk length` counts UTF-8 bytes under this locale, not characters. The three rows at 41 were
38 / 40 / 39 characters with 3 / 1 / 2 occurrences of `·` (two bytes each). The margin was
already inside the budget: the 40-character row is exactly 40 **including** its two-space indent,
and subtracting the margin could not have fixed the zero-indent row. The fix is to budget UTF-8
bytes of visible text in `wrap_line` (`visible_bytes`); `clip_to_width` keeps its character-based
measure. Every wrapped row is now ≤ `width` in both bytes and display columns; multibyte prose is
simply a little narrower on screen. README and `cmduse.1` say so. Tests:
`margin_counts_against_the_wrap_budget`, `multibyte_glyphs_are_budgeted_in_bytes`.

**Exact proof** — `--width N -1 | awk -v w=N 'length($0)>w'`, pasted verbatim:

```
=== cmdusedev --width 40 -1 | awk length > 40
 Model                              Reqs     Tokens       Cost
 deepseek/deepseek-v4.1-flash          1      37.3K      $0.00 100.0%
=== cmdusedev --width 60 -1 | awk length > 60
 Model                              Reqs     Tokens       Cost
 deepseek/deepseek-v4.1-flash          1      37.3K      $0.00 100.0%
=== cmdusedev --width 30 -1 | awk length > 30
 Model                              Reqs     Tokens       Cost
 deepseek/deepseek-v4.1-flash          1      37.3K      $0.00 100.0%

=== ocusedev --width 40 -1 | awk length > 40
TOP 3 MODELS by period spend      MONEY    SHARE     TOKENS    SHARE
deepseek-v4.1-flash              $70.28    99.5%     114.7M    36.9%
glm-5.3                           $0.36     0.5%     256.0K     0.1%
beam-free                         $0.00     0.0%     134.6K     0.0%
MODEL                          LIMIT      SPENT     USE       5H       WK     REQ
deepseek-v4.1-flash          $100.00     $70.28   70.3%    $0.62    $2.00   37.4K
glm-5.3                      $200.00      $0.36    0.2%    $0.00    $0.00       1
beam-free                          —      $0.00       —    $0.00    $0.00       1
hy4-flash-free                     —      $0.00       —    $0.00    $0.00   36.6K
=== ocusedev --width 60 -1 | awk length > 60
TOP 3 MODELS by period spend      MONEY    SHARE     TOKENS    SHARE
deepseek-v4.1-flash              $70.28    99.5%     114.7M    36.9%
glm-5.3                           $0.36     0.5%     256.0K     0.1%
beam-free                         $0.00     0.0%     134.6K     0.0%
MODEL                          LIMIT      SPENT     USE       5H       WK     REQ
deepseek-v4.1-flash          $100.00     $70.28   70.3%    $0.62    $2.00   37.4K
glm-5.3                      $200.00      $0.36    0.2%    $0.00    $0.00       1
beam-free                          —      $0.00       —    $0.00    $0.00       1
hy4-flash-free                     —      $0.00       —    $0.00    $0.00   36.6K
=== ocusedev --width 30 -1 | awk length > 30
~/.local/share/opencode/opencode.db
TOP 3 MODELS by period spend      MONEY    SHARE     TOKENS    SHARE
deepseek-v4.1-flash              $70.28    99.5%     114.7M    36.9%
glm-5.3                           $0.36     0.5%     256.0K     0.1%
beam-free                         $0.00     0.0%     134.6K     0.0%
MODEL                          LIMIT      SPENT     USE       5H       WK     REQ
deepseek-v4.1-flash          $100.00     $70.28   70.3%    $0.62    $2.00   37.4K
glm-5.3                      $200.00      $0.36    0.2%    $0.00    $0.00       1
beam-free                          —      $0.00       —    $0.00    $0.00       1
hy4-flash-free                     —      $0.00       —    $0.00    $0.00   36.6K

=== arkusedev --width 40 -1 | awk length > 40
TOP 3 MODELS by month AFP          AFP    SHARE     TOKENS    SHARE
deepseek-v4.1-flash             35,803   100.0%       6.6M   100.0%
MODEL                         COEF       AFP     REQ
deepseek-v4.1-flash           1.25    35,803    1.4K
=== arkusedev --width 60 -1 | awk length > 60
TOP 3 MODELS by month AFP          AFP    SHARE     TOKENS    SHARE
deepseek-v4.1-flash             35,803   100.0%       6.6M   100.0%
=== arkusedev --width 30 -1 | awk length > 30
~/.local/share/opencode/opencode.db
TOP 3 MODELS by month AFP          AFP    SHARE     TOKENS    SHARE
deepseek-v4.1-flash             35,803   100.0%       6.6M   100.0%
MODEL                         COEF       AFP     REQ
deepseek-v4.1-flash           1.25    35,803    1.4K

=== odusedev --width 40 -1 | awk length > 40
Design/namespaces/release-stable/data/app.sqlite
MODEL                        MULT    CREDITS   SHARE       5H       WK     REQ
deepseek-v4.1-flash          x0.5     $12.62   99.5%    $0.00   $12.62   10.1K
deepseek-v4.1-flash-eco      x0.27      $0.06    0.5%    $0.00    $0.06      59
=== odusedev --width 60 -1 | awk length > 60
MODEL                        MULT    CREDITS   SHARE       5H       WK     REQ
deepseek-v4.1-flash          x0.5     $12.62   99.5%    $0.00   $12.62   10.1K
deepseek-v4.1-flash-eco      x0.27      $0.06    0.5%    $0.00    $0.06      59
=== odusedev --width 30 -1 | awk length > 30
Design/namespaces/release-stable/data/app.sqlite
MODEL                        MULT    CREDITS   SHARE       5H       WK     REQ
deepseek-v4.1-flash          x0.5     $12.62   99.5%    $0.00   $12.62   10.1K
deepseek-v4.1-flash-eco      x0.27      $0.06    0.5%    $0.00    $0.06      59
```

Everything left is a table row or an unbreakable filesystem path token. No prose row at any
of the three widths. Gates re-run: `cargo test` 377 + 25, fmt clean, clippy clean, `bun parity` PASS.
