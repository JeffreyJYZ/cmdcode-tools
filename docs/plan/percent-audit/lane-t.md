# Lane T — find every place the panel or the CLI truncates instead of wrapping (read-only)

Repo `/Users/jyz/dev/cmdcode-tools`. Read-only: your only writes are the two docs paths at the end.

## Why

The user reported two clipped strings in the Go sidebar:

```
the allowance changed during this …            (a 110-char sentence cut at 34)
deepseek-v…: $70.15/$100 · 70.1% now            (an 18-char id cut to 11)
```

Both come from using truncation as a layout tool at `ROW_WIDTH = 37`
(`opencode-plugin/src/constants/sidebar.ts:11`, `clip()` at `sidebar/rows.ts:50`). One lane is fixing those
two. Nobody has looked for the rest.

## What to produce

`docs/plan/percent-audit/truncation.md`, every finding with `file:line`:

1. **Every `clip(` call site in `opencode-plugin/src/sidebar/**`** (all four families: `rows.ts` Command Code,
   `zen.ts` Go/Zen, `ark.ts` ARK, `od-rows.ts` OpenDesign). For each: what text it truncates, whether that text
   is an identity (model id, plan name), a sentence, or a fixed-width token (money, percent), and how many
   columns it gets. Rank by "would a user see a broken-looking line": identity and sentences first, numeric
   tokens last.
2. **Every rendered string that can exceed `ROW_WIDTH`** even without `clip` — a row's `parts()` width, where
   `parts()` is `sidebar/rows.ts:78`. Name the payload field that drives it (model id length, request counts,
   money formatting, a plan label).
3. **The same question for the CLI**, which has a real terminal width instead of 37 columns:
   `cmduse/src/ocuse/render.rs`, `cmduse/src/oduse/render/**`, `cmduse/src/arkuse/**`. Does any renderer hard
   truncate a sentence or an identity rather than wrapping? Quote the line. Check what `ocuse -1` does at a
   narrow width if you can do it without a tty (a `--width` flag or a piped `COLUMNS`).
4. **A ranked fix list**: which families need the wrapper, which are safe, and the one helper they should all
   use (another lane is adding `wrap(text, width, maxLines)` beside `clip` in `sidebar/rows.ts` — say whether
   that placement is right for all four families or whether it belongs in `rows.ts` under a different name).

## Rules

- Do not modify any source file, do not commit, do not take a lock on anything a lane is editing. If a file is
  being written while you read it, read it again rather than assuming.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`, and **never pass `-r` to `rg`** (it is ripgrep's
  replace flag and silently rewrites the output).
- Every claim needs `file:line`; a claim without one is not a finding.
