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
