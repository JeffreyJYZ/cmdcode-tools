# Lane U — apply the wrapper to the other three sidebar families

Repo `/Users/jyz/dev/cmdcode-tools`, `opencode-plugin/`. Work on top of the uncommitted lane-S change: it added
`wrap(text, width = ROW_WIDTH, maxLines = 2): Wrapped` to `src/sidebar/rows.ts` and used it in `zen.ts`. **Do
not revert, rewrite or duplicate that helper** — reuse it.

## Why

`docs/plan/percent-audit/truncation.md` found 23 `clip()` sites still acting as layout. The Go family is fixed;
these remain:

| finding | where |
| --- | --- |
| OpenDesign per-model id cut to ~16 columns | `src/sidebar/od-rows-parts.ts:78-89` |
| model-name identity rows truncated | `src/sidebar/ark.ts`, `src/sidebar/rows.ts` |
| ARK plan / profile text cut | `src/sidebar/ark.ts` |
| Command Code `Plan` and `Deal` rows take arbitrary upstream strings with no bound | `src/sidebar/rows.ts:396-400`, `:491-500` |

An identity — a model id, a plan name, a profile — is the one field that must never be abbreviated to fit a
number beside it. A sentence must wrap or be rewritten compactly, never cut mid-phrase.

## Task

1. **Add one shared continuation helper** (`mutedWrap` or equivalent) beside `wrap`, so the four families do
   not each re-implement the "emit the first line on the row, the rest as muted continuation rows aligned
   under the value column" loop. Refactor `zen.ts`'s existing use onto it — behaviourally identical output.
2. **Identity rows keep the whole identity.** For each site above: put the identity on the label, move the
   value to the row only if it fits, and push the remainder to a continuation line. If an identity alone is
   wider than `ROW_WIDTH`, that is the only case where truncation is correct — and then it truncates the
   identity's *tail*, never its distinguishable head.
3. **`Plan` and `Deal` need a bound, not a clip.** Those are upstream strings of unknown length; a wrapped
   `Deal` badge (`-40% · Ends September 27, 2026`) is two short lines, which is fine, but the row must not
   grow unbounded — cap it at two lines and drop the trailing clause rather than cutting a word.
4. **No family may regress**: the four families' tests all pass, and every rendered line's `parts()` width is
   ≤ `ROW_WIDTH`.

## Tests

- `an_identity_is_never_abbreviated_to_fit_a_value` — an OpenDesign id and an ARK profile both render whole.
- `a_deal_badge_wraps_to_at_most_two_lines` — assert the exact two lines and that no word is cut.
- `every_family_renders_within_the_panel_width` — one table-driven test over fixtures for all four families,
  asserting `parts()` width per line; this is the regression net that would have caught the original bug.
- `muted_wrap_matches_the_zen_layout` — the refactor of `zen.ts` onto the shared helper is byte-identical.

## Release

`package.json` already reads 0.5.41 from lane S — **leave the version alone**; the two lanes ship as one
release. Re-run `bun run build` at the end so `dist/` matches.

## Constraints

- Own `opencode-plugin/src/sidebar/**`, `opencode-plugin/test/**`, your two docs paths. Do not bump the version.
- Do not touch `~/.config/opencode/opencode.json`, `cmduse/**`, `core/**`, `oc-cmd-compare/**`, `aa-models/**`.
  No commit, tag, publish or `AGENTS.md`.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`, and never pass `-r` to `rg`.
- Gate, foreground: `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build`.

Report to `docs/plan/percent-audit/lane-u.md`: each site changed, the shared helper's signature, the
table-driven width test, and a rendered panel per family.

---

# Lane U report — identities whole, prose bounded

All changes uncommitted, on top of lane S. Files: `src/sidebar/rows.ts`, `src/sidebar/zen.ts`, `src/sidebar/ark.ts`, `src/sidebar/od-rows-parts.ts`, `test/sidebar-lane-u.test.ts` (new), `test/sidebar-od-rows.test.ts`, `test/sidebar-od-permodel.test.ts`, `test/sidebar-ark.test.ts`, `test/sidebar-zen.test.ts` (one guard on lane S's fixture), this file. `package.json` still 0.5.41; `dist/` rebuilt and carries 0.5.41. No commit, tag, publish or config change.

## Sites changed

| Site | Before | After |
| --- | --- | --- |
| `od-rows-parts.ts` per-model table | value `$88/$120 (73.3%)` forced the id to ~16 columns; `clip(entry.id, max(4, 37 − value.length − 2))` | value is `$88/$120` only; `73.3% now` on an indented muted continuation under the value column, the Go lane's pattern. Id now whole whenever `id + 2 + value ≤ 37`; if not, the id gets its own row and the money drops below. Clip only when the id alone exceeds 37, keeping its head. |
| `rows.ts` `modelRows` (Command Code `Model`) | `clip(name, valueWidth("Model"))` | whole name in the value slot; a name over 30 columns becomes a full-width banner row (`clip(name, ROW_WIDTH)` if even 37 is too narrow). |
| `zen.ts` `zenRows` (Go/Zen `Model`) | same clip | same whole-name treatment. |
| `ark.ts` `arkRows` (ARK `Model`) | same clip | same whole-name treatment. |
| `ark.ts` `Plan` | one row clipped at 31: `medium · AFP plan · agent-plan_cn-beijing_medium` → tail lost | `Plan: medium · AFP plan` with `agent-plan_cn-beijing_medium` whole on a muted continuation. A genuinely long plan id becomes a banner; the profile still gets its own line. |
| `rows.ts` `usageRows` `Plan` | `${plan} · $${cap}/mo credits`, unbounded | fits on one row when ≤31; otherwise the plan name is whole (banner if needed) and the credit figure rides on a continuation. |
| `rows.ts` `modelRows` `Deal` | arbitrary upstream badge emitted raw, could grow past 37 | `boundedDeal` wraps at word boundaries to at most two lines, first line on the row and second indented under the value. If it still will not fit, the trailing clause is dropped at ` · `/`, `; no word is cut. |
| `ark.ts` `AFP (this model)` (found by the new width net) | `no usage in this period` overflowed a 16-column label (41 columns) | the sentence sits whole on a muted continuation; the labelled row keeps an empty value. |

`clip` stays where it belongs: fixed numeric tokens and the final guard for an identity wider than the whole panel. Lane S's `wrap` is untouched; `zen.ts`'s local continuation loop was removed, not duplicated.

## Shared helper

`mutedWrap(rows: SidebarRow[], text: string, width: number = valueWidth(""), maxLines: number = 2): void`, exported from `src/sidebar/rows.ts` beside `wrap`. It calls `wrap(text, width, maxLines)` and pushes one `["", line, "muted"]` row per line. `zen.ts` imports it; the cap-change line it rendered at lane S is byte-identical (`muted_wrap_matches_the_zen_layout` checks both the direct call and `zenRows`' output against the same two rows). `boundedDeal(text, width): string[]` is a private helper next to it for the badge's two-line bound.

## Tests

New, all in `test/sidebar-lane-u.test.ts`: `an_identity_is_never_abbreviated_to_fit_a_value` (a 31-column OpenDesign id that cannot sit beside `$88/$120`, and the 28-column ARK profile, both render whole with no ellipsis); `a_deal_badge_wraps_to_at_most_two_lines` (exact two rows for `Flash sale -40% · Ends September 27, 2026`, a third clause dropped, no word cut); `every_family_renders_within_the_panel_width` (table-driven, four families — Command Code with a long plan and a long deal, Go/Zen with the long note and a huge cap change, ARK with the long profile, OpenDesign with both fixtures — asserting `parts(row).join("").length` and `rowWidth(row)` ≤ `ROW_WIDTH` on every line, with the family and row in the failure message); `muted_wrap_matches_the_zen_layout`. Existing OD per-model assertions updated for the share continuation; the ARK unread-model assertion updated for its continuation. One type guard added to lane S's `sidebar-zen.test.ts` fixture.

The width test is the regression net the audit asked for: run against the pre-fix tree it fails on the unbounded `Deal` badge (47 columns), the long Command Code `Plan` row (52), and the ARK `no usage` row (41). The OpenDesign id defect needed the explicit whole-id assertion in `an_identity_is_never_abbreviated_to_fit_a_value`: at 19 columns it fit exactly beside the old share-bearing value, so pure width was not enough to catch the abbreviation.

## Rendered panels

Command Code — the deal is two short lines, no clause cut:

```
Plan: GOAT · $70/mo credits
Monthly: $55.38 / $70 (79.1%)
5-hour: $0.55/$14 (3.9%)
Weekly: $18.46/$35 (52.7%)
Period: 7.3K requests · $55.29
Model: DeepSeek V4.1 Flash
Deal: Flash sale -40% · Ends
      September 27, 2026
```

Go/Zen — lane S's layout is unchanged by the refactor:

```
Plan: Go · limits per model
5-hour: 12% of limit (server)
  20.0% elapsed · resets 4h
  $0 local
Weekly: 40% of limit (server)
  71.4% elapsed · resets 2d
  $0 local
Monthly: 76% of limit (server)
  cap in 22h 44m · resets 27d
  $69.98 local
  limit changed mid-period
  76% server · 70.0% now
  limit $80→$100 on 2026-11-19
Period: 58 requests · $69.98
  by model · this month
deepseek-v4.1-flash: $69.98/$100
                     70.0% now
glm-5.3-flash: $1.50/$60
               2.5% now
─────────────────────────────────────
Model: DeepSeek V4.1 Flash
Allowance: $100/mo
Rates: $0.15/$0.6 in/out
  cache read $0.003
```

ARK — profile whole on its own line:

```
Plan: medium · AFP plan
  agent-plan_cn-beijing_medium
5-hour: 0 AFP
Weekly: 0 AFP
Monthly: 4,300 AFP · 231 req
Period: 231 requests · 4,300 AFP
─────────────────────────────────────
Model: deepseek-v4.1-flash
AFP (this model): 4,300 AFP · 231 req
  100.0% of the period · coef 1.25
```

OpenDesign — the id is no longer sacrificed to the share:

```
Plan: go plan · estimate
  credits = list-price $ x multiplier
  estimate · 5h/7d cut locally
5-hour: $4.20/$10 (42.0%)
  12 req
  of $10 · Flash caps
Weekly: $9.10/$30 (30.3%)
  58 req
  of $30 · Flash caps
Monthly: $98.40/$120 (82.0%)
  cap in 2d 4h · resets 20d
  231 req
  of $120 · Flash caps
Period: 231 requests · $98.40 credits
Wallet: $18.40 balance
─────────────────────────────────────
  by model · this period
deepseek-v4.1-flash: $88/$120
                     73.3% now
glm-5.3-flash: $10.40/$120
               8.7% now
```

## Gate

Foreground, all green: `bun test` (379 pass, 0 fail), `bun check`, `bun fmt --check`, `bunx biome lint` (one pre-existing info about the `$schema` pin, exit 0), `bun run build`.
