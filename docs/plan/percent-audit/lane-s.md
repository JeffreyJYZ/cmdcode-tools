# Lane S — the sidebar must wrap, not truncate sentences or names

Repo `/Users/jyz/dev/cmdcode-tools`, package `opencode-plugin/` (currently 0.5.40, published and pinned).

## What the user sees

```
Monthly: 76% of limit (server)
         the allowance changed during this …
deepseek-v…: $70.15/$100 · 70.1% now
```

Two defects, both from `clip()` (`src/sidebar/rows.ts:50`) being used as a layout tool:

1. **A sentence is cut mid-phrase.** `ROW_WIDTH = 37` (`src/constants/sidebar.ts:11`), the note is ~110
   characters, so it renders 34 characters plus `…`. A truncated explanation reads as broken output, not as a
   short one.
2. **The model name is sacrificed to make the value fit.** `deepseek-v4.1-flash` is 18 columns and
   `$70.15/$100 · 70.1% now` is 23; at width 37 the name gets clipped to `deepseek-v…`. The identity of the
   row is the one thing that must never be abbreviated.

## What to build

- **A word-boundary wrapper** for the panel (`wrap(text, width, maxLines)`), next to `clip` in `rows.ts`.
  Continuation rows already exist in this file's vocabulary (the meter's muted `$69.98 local` line uses one),
  so render wrapped lines as muted continuation rows. Never emit `…` in the middle of a sentence.
- **The note gets at most two lines.** If the full sentence does not fit in two, use a compact form built for
  the panel rather than the CLI's prose — the two figures are already on screen above and below it. Shape the
  compact form to say *that the limit moved* and *the two shares*: e.g. `limit changed mid-period` then
  `76% server · 70.0% now`. The full sentence stays in the CLI, where there is width for it.
- **A model row keeps its full name, always.** Put spend `$70.15/$100` on the row and `70.1% now` on its muted
  continuation line; never shorten `deepseek-v4.1-flash` and never drop the `now` label. If a name is longer
  than the remaining width even alone, that is the one case where clipping is correct — and the report should
  name the longest id that occurs in practice.
- **The cap-change line** (`limit $80→$100 on 2026-11-19`) uses the same wrapper, not `clip`.
- Keep the fixed-width column slots: the panel aligns values, so a continuation line must sit under the value
  column, not under the label.

## Tests (hermetic fixtures, no spawn)

- `a_note_never_ends_in_an_ellipsis` — the 110-character payload renders every line complete.
- `a_long_note_falls_back_to_the_compact_two_line_form` — assert the compact strings, and that the full
  sentence is not present.
- `a_model_row_keeps_its_full_name` — the rendered row contains `deepseek-v4.1-flash` verbatim, with
  `70.1% now` on the continuation.
- `a_cap_change_line_wraps_instead_of_clipping`.
- Width pins: every rendered line's `parts()` width is ≤ `ROW_WIDTH`.

## Release

Bump `opencode-plugin/package.json` to `0.5.41`, `bun run build` so `dist/` carries it.

## Constraints

- Own `opencode-plugin/src/sidebar/**`, `opencode-plugin/src/constants/sidebar.ts` if a width constant is
  needed, `opencode-plugin/test/**`, `opencode-plugin/package.json` (version), plus your two docs paths.
- Do not touch `~/.config/opencode/opencode.json`, `cmduse/**`, `core/**`, `oc-cmd-compare/**` or
  `aa-models/**`. No commit, tag, publish or `AGENTS.md`.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`, and never pass `-r` to `rg`.
- Gate, foreground: `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build`.

Report to `docs/plan/percent-audit/lane-s.md`: the rendered panel for the user's payload, the wrapper's
signature, the longest model id that survives unclipped, and every test name.

---

# Lane S report — wrap, not truncate

Files changed (all uncommitted): `opencode-plugin/src/sidebar/rows.ts`, `opencode-plugin/src/sidebar/zen.ts`, `opencode-plugin/test/sidebar-zen.test.ts`, `opencode-plugin/package.json` (0.5.40 → 0.5.41), plus the two docs paths (`docs/agents/percent-sidebar.md`, this file). `dist/` rebuilt locally (gitignored); `dist/index.js` carries `0.5.41`. Pin untouched. No commit, tag or publish.

## Rendered panel for the user's payload

Fixture: `ocuse -1 --json` body with the reported 76% server meter, the 110-character note, one `$80→$100` cap change on 2026-11-19, and `deepseek-v4.1-flash` at `$70.15 / $100`. `meta.name` is `DeepSeek V4.1 Flash`; `parts(row).join("")` is quoted verbatim, so leading spaces are visible.

```
Plan: Go · limits per model
5-hour: 12% of limit (server)
  20.0% elapsed · resets 4h
  $0.50 local
Weekly: 40% of limit (server)
  71.4% elapsed · resets 2d
  $1.50 local
Monthly: 76% of limit (server)
  cap in 22h 44m · resets 27d
  $70.15 local
  limit changed mid-period
  76% server · 70.2% now
  limit $80→$100 on 2026-11-19
Period: 58 requests · $70.15
  by model · this month
deepseek-v4.1-flash: $70.15/$100
                     70.2% now
z-ai/glm-5.3-flash: $1.50/$60
                    2.5% now
─────────────────────────────────────
Model: DeepSeek V4.1 Flash
Allowance: $100/mo
```

Before: `the allowance changed during this …` and `deepseek-v…: $70.15/$100 · 70.1% now`. The note is now a two-line statement of the same fact; the full id is on its own row. The compact `70.2% now` is deliberately the top by-model row's own `cost / limit × 100`, rounded the same way, so the figure named in the note is byte-identical to the one below it (the brief's 70.0/70.1 are illustrative values from other fixtures). It is taken from `ranked[0]`, not the active model, so the two can never disagree when the session's model is not the top spender.

## Wrapper signature

`wrap(text: string, width: number = ROW_WIDTH, maxLines: number = 2): Wrapped`, exported from `src/sidebar/rows.ts` next to `clip`.

`Wrapped = { lines: string[]; complete: boolean }`. It packs whole words up to `width` columns (default 37), returns at most `maxLines` lines, and emits no ellipsis. A word longer than `width` is hard-split rather than losing its tail. `complete: false` means the text did not fit; the caller then uses a compact form. Rows are emitted through the panel's existing muted-continuation shape, and the by-model `now` share is indented by the label's length so `parts()` places it under the value column.

## Longest model id that survives unclipped

Name budget is `ROW_WIDTH − value.length − 2`. At the reported value `$70.15/$100` (11 columns) that is 24 columns. Of the Go allowance ids in `core/zen.json` (`z.go.plans[*].allowanceByModel`), the longest that survive are `deepseek-v4.1-flash` (19 columns, the reported model) and `minimax-m3.1-flash` (18). The only two that exceed the budget are `muse-spark-1.2-contributor` and `muse-spark-1.3-contributor` (26 each); they clip only when a value is wide enough to leave under 26 columns, and survive when the value is short (verified with `$1.50/$6`, budget 27). The percentage never consumes name width — it moved to its own continuation line.

## Tests

New, all in `test/sidebar-zen.test.ts` (hermetic fixtures, no spawn):

- `a_note_never_ends_in_an_ellipsis`
- `a_long_note_falls_back_to_the_compact_two_line_form`
- `a_model_row_keeps_its_full_name`
- `a_cap_change_line_wraps_instead_of_clipping`
- `every_rendered_line_fits_the_panel_width` (width pins: `parts()` width ≤ `ROW_WIDTH` on every rendered line)

Existing tests updated for the new by-model layout: `per-model usage is listed like the console's Go page`, `the model row reads now, never a bare (70.0%)`, `the note renders when present and nothing when absent`.

## Gate

Foreground, all green: `bun test` (375 pass), `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build`. `biome lint` reports one pre-existing info (`biome.json` `$schema` 2.6.3 vs CLI 2.6.8), exit 0. Reconnaissance memory at `docs/agents/percent-sidebar.md`.
