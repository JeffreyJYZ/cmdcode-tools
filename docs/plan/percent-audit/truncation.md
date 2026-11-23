# Truncation audit — sidebar and CLI

Read-only audit for the percent-audit wave. No source file was modified. Every finding below carries `file:line` against the tree at audit time.

**Tree state.** `opencode-plugin/src/sidebar/rows.ts` and `opencode-plugin/src/sidebar/zen.ts` carried uncommitted edits from the lane fixing the two reported strings. `zen.ts` changed while this audit was reading it (the by-model table gained a continuation row for the `now` share). The file was re-read after the change; all line numbers below are from the re-read version. The two reported strings are already addressed in the working tree:

- `the allowance changed during this …` — was `clip(usage.account.monthly.note, valueWidth(""))`, now wrapped with a compact fallback at `opencode-plugin/src/sidebar/zen.ts:535-546`.
- `deepseek-v…: $70.15/$100 · 70.1% now` — the share was folded into the value, leaving an 11-column id slot. Now the value is `$70.15/$100` only and the share moved to an indented continuation at `opencode-plugin/src/sidebar/zen.ts:565-582`.

Width model: `ROW_WIDTH = 37` (`opencode-plugin/src/constants/sidebar.ts:11`). `valueWidth(label) = 37 − label.length − 2` (`opencode-plugin/src/sidebar/rows.ts:124-126`); a continuation row (`row[0] === ""`) gets 2 spaces plus `valueWidth("") = 35` (`parts()` at `opencode-plugin/src/sidebar/rows.ts:129-132`, `rowWidth()` at `:135-138`). `clip()` keeps `width − 1` characters plus an ellipsis (`opencode-plugin/src/sidebar/rows.ts:51-53`).

## 1. Every `clip(` call site in `opencode-plugin/src/sidebar/**`

Ranking: **A** = identity or prose a user reads, clipped today; **B** = diagnostic prose or a mixed identity/token row; **C** = numeric token that only clips under abnormal magnitudes. Counts are the width passed to `clip`.

| Rank | Site | Text truncated | Kind | Columns |
| --- | --- | --- | --- | --- |
| A | `opencode-plugin/src/sidebar/zen.ts:589` | `name` (active model display name / id) | identity | `valueWidth("Model")` = 30 |
| A | `opencode-plugin/src/sidebar/rows.ts:478` | `name` (active model display name / id) | identity | 30 |
| A | `opencode-plugin/src/sidebar/ark.ts:369` | `fallbackName` (session model id) | identity | 30 |
| A | `opencode-plugin/src/sidebar/od-rows-parts.ts:89` | `entry.id` (per-model table id) | identity | `max(4, 37 − value.length − 2)`; value at `:78-84` includes `$x/$y (p%)`, so a 19-char value leaves 16 for a 26-char id — the same failure as the reported Go row, still present here |
| A | `opencode-plugin/src/sidebar/zen.ts:575` | `entry.id` (per-model table id) | identity | `max(4, 37 − value.length − 2)`; value is now only `$cost/$cap`, so ~24 columns and a 19-char id fits — residual only for ids beyond that |
| A | `opencode-plugin/src/sidebar/rows.ts:455` | `entry.id` (per-model table id) | identity | `max(4, 37 − value.length − 2)`; value is `money(cost)` only (`:452`), so ~27 columns — residual |
| A | `opencode-plugin/src/sidebar/ark.ts:363` | `entry.id` (per-model table id) | identity | `max(4, 37 − value.length − 2)`; value is `afp()` only (`:362`) — residual |
| A | `opencode-plugin/src/sidebar/ark.ts:299-302` | `${plan} · AFP plan · ${profile}` | identity (tier + arkcli profile) | `valueWidth("Plan")` = 31; a long profile name clips its tail |
| B | `opencode-plugin/src/sidebar/rows.ts:406` | `usage API: ${usage.error}` | diagnostic sentence | 35 |
| B | `opencode-plugin/src/sidebar/zen.ts:424` | `usage API: ${usage.accountError}` | diagnostic sentence | 35 |
| B | `opencode-plugin/src/sidebar/ark.ts:312` | `usage API: ${usage.accountError}` | diagnostic sentence | 35 |
| B | `opencode-plugin/src/sidebar/od-rows.ts:74` | `capNote(chosen, cap)` — `of $120 · Flash caps (Eco $220)` | explanatory sentence; `capNote()` already drops the alternative when it will not fit (`opencode-plugin/src/sidebar/od-rows-parts.ts:121-126`), so this outer clip is normally a no-op | 35 |
| B | `opencode-plugin/src/sidebar/od-rows.ts:94` | `${plan} plan · estimate` | identity (plan label) + fixed suffix | `valueWidth("Plan")` = 31; all four `OD_PLANS` fit (`opencode-plugin/src/constants/sidebar.ts:38`) — safe today |
| C | `opencode-plugin/src/sidebar/od-rows.ts:101` | `credits = list-price $ x multiplier` | fixed prose, exactly 35 chars | 35 (no-op) |
| C | `opencode-plugin/src/sidebar/od-rows.ts:102` | `estimate · ${cuts} cut locally` | fixed prose + 5h/7d token, ≤28 chars | 35 (no-op) |
| C | `opencode-plugin/src/sidebar/od-rows.ts:105` | `no cap set published` | fixed prose, 20 chars | 35 (no-op) |
| C | `opencode-plugin/src/sidebar/od-rows.ts:151-154` | `${count} requests · ${money} credits` | numeric sentence | 29 |
| C | `opencode-plugin/src/sidebar/od-rows.ts:166` | `plan-model credits ${money} · no meter` | numeric sentence | 35 |
| C | `opencode-plugin/src/sidebar/od-rows-parts.ts:51` | `${money(balance)} balance${" · cached"}` | numeric sentence | `valueWidth("Wallet")` = 29 |
| C | `opencode-plugin/src/sidebar/ark.ts:336-339` | `${count} requests · ${afp}${yuan}` | numeric sentence | 29 |
| C | `opencode-plugin/src/sidebar/ark.ts:349` | `${afpPerRequest} AFP/request ±x% vs meter` | numeric | 35 |
| C | `opencode-plugin/src/sidebar/ark.ts:373-376` | `${afp} · ${count} req` | numeric | `valueWidth("AFP (this model)")` = 19 (tightest labelled value in the panel) |
| C | `opencode-plugin/src/sidebar/ark.ts:384-387` | `${pct}% of the period · coef ${coef}` | numeric | 35 |

Two related non-`clip` cases:

- `opencode-plugin/src/sidebar/od-rows-parts.ts:40-42` drops the whole wallet reason when `no meter · ${walletError}` exceeds `valueWidth("Wallet")`; a long daemon URL disappears entirely. The doc comment at `:29-32` says this is deliberate, but it is a silent sentence loss, not a wrap.
- `clip()` measures JS string length, not grapheme width (`opencode-plugin/src/sidebar/rows.ts:52`): an emoji payload counts 2 and renders as 1 or 2 columns. No current payload uses one.

## 2. Rendered strings that can exceed 37 columns without `clip`

`parts()` (`opencode-plugin/src/sidebar/rows.ts:129-132`) draws `label: value`; `rowWidth()` (`:135-138`) is `label.length + 2 + value.length`, or `2 + value.length` for a continuation. Rows below are built with no width control.

| Site | Row / payload field | Worst case |
| --- | --- | --- |
| `opencode-plugin/src/sidebar/rows.ts:396-400` | `Plan: ${usage.plan} · $${monthlyCap}/mo credits` — `usage.plan` is an identity string, `usage.monthlyCap` numeric | unconstrained plan name; 34-char value already gives 40 columns |
| `opencode-plugin/src/sidebar/rows.ts:491-500` | `Deal: ${meta.deal.badge} · ends ${Mon} ${dd}` — `meta.deal.badge` is free-form promotion prose from the docs row | a 27-char badge plus the 14-char suffix exceeds 37; the date is pre-compacted but the badge is not |
| `opencode-plugin/src/sidebar/rows.ts:415-419` | `Monthly: ${money(used)} / ${money(cap)} (${pct}%)` — `monthlyCap` | large money strings grow past 29 value columns |
| `opencode-plugin/src/sidebar/rows.ts:328-333` | `windowRows()` use line — `money(used)`, `money(cap)`, `pct` | same; labels are 5-7 chars, so the value has 28-30 columns |
| `opencode-plugin/src/sidebar/rows.ts:334` | continuation `${lead} · resets ${until()}` — `lead` is `LIMIT EXCEEDED` / `cap in …` / `elapsed` | bounded (~30 chars) in practice; safe |
| `opencode-plugin/src/sidebar/rows.ts:510-511`, `opencode-plugin/src/sidebar/zen.ts:605-606` | `Rates: ${rate(in)}/${rate(out)} in/out` and continuation `cache read … · write …` — rate payloads | rate() emits 4 decimals (`opencode-plugin/src/sidebar/rows.ts:262-265`); a large $/M rate can push the line over |
| `opencode-plugin/src/sidebar/rows.ts:488` | `Min plan: ${meta.minPlan}` — plan identity | unbounded string field; short in today's catalogue |
| `opencode-plugin/src/sidebar/zen.ts:418` | `Plan: ${oc?.plan ?? "Go"} · limits per model` — `oc.plan` identity | 26 chars today → 32 columns; safe for `go`/`go-plus` |
| `opencode-plugin/src/sidebar/zen.ts:398`, `opencode-plugin/src/sidebar/ark.ts:249` | meter value `${pctText}% of limit (${basis})` / `${brief(used)}/${brief(cap)} (${pctText}%)` | bounded (~24 chars) → ≤33 columns; safe |
| `opencode-plugin/src/sidebar/zen.ts:552-555`, `opencode-plugin/src/sidebar/ark.ts:334-341` | `Period` value — request counts and money | count() caps at `M`/`K` (`opencode-plugin/src/sidebar/rows.ts:267-271`); money is the growth term |
| `opencode-plugin/src/sidebar/od-rows.ts:106-111`, `:157-161` | fixed continuations `month start inferred`, `no completed turns in this period` | ≤31 columns; safe |
| `opencode-plugin/src/sidebar/od-rows-parts.ts:76-85` | per-model value `${money(credits)}/${money(cap)} (${pct}%)` — drives the id width at `:88` | the only place a value cuts an identity as collateral; see rank A above |

## 3. CLI: truncation at a real terminal width

- **No explicit sentence/identity truncate in the four CLI renderers except one table cell.** `cmduse/src/oduse/render/report/mod.rs:70-80` defines `truncate(text, width)` (ellipsis at `width − 1` chars), used only at `cmduse/src/oduse/render/report/session.rs:87-89` for a project title / session id in a 32-column table (`NAME_W` at `cmduse/src/oduse/render/report/session.rs:14`). That is a fixed table cell, not a prose line; the analogous ocuse/arkuse session tables use the raw short id with `{:<32}` (`cmduse/src/ocuse/render.rs:1620-1629`, `cmduse/src/arkuse/render.rs:1650-1659`), which shifts columns right for a long id instead of clipping it.
- **Prose is printed whole in the one-shot frame.** The 110-character sentence from the brief is built at `cmduse/src/ocuse/window.rs:541-543` and emitted without wrapping at `cmduse/src/ocuse/render.rs:653-655`; the OpenDesign caveats are emitted whole at `cmduse/src/oduse/render/dash.rs:151-154`, `:157-161`, `:164-165`, `:170-174`; the source reason is whole at `cmduse/src/oduse/render/snapshot.rs:55-61`; the ARK reconciliation notes are joined into one line at `cmduse/src/arkuse/render.rs:567-584`. No ellipsis, no explicit cut — the terminal soft-wraps them.
- **Watch mode hard-cuts every frame line from the right.** `redraw_frame()` calls `clip_to_width(line, cols)` per line (`cmduse/src/lib.rs:489-493`); `clip_to_width` drops trailing visible characters with no ellipsis (`cmduse/src/lib.rs:413-474`). At 80 columns the 110-char note above loses its tail. Fields are laid out in importance order precisely so this cut is survivable (`cmduse/src/ocuse/render.rs:157-159`, `:208-213`); model ids are first in their rows (`:340-346`, `:383-392`), so the cut lands on numeric columns, never the identity.
- **Model-id columns.** ocuse sizes the name field to the longest displayed id with a floor of 28 (`cmduse/src/ocuse/render.rs:657-667`), as does oduse (`cmduse/src/oduse/render/model_table.rs:13-21`); arkuse hard-codes `{:<28}` (`cmduse/src/arkuse/render.rs:362-367`, `:402-407`, `:656`, `:1357-1368`, `:1389`), so a long ARK model id pushes its numbers right instead of clipping them.
- **`ocuse -1` at a narrow width:** there is no terminal-width flag — `--bar-width` sets the gauge only (`cmduse/src/ocuse/cli.rs:40`, `cmduse/src/lib.rs:165`). Width comes from `stty size < /dev/tty` (`cmduse/src/lib.rs:393-411`); when piped there is no tty, so `cols = 0`, `cols_opt = None` and `clip_to_width` returns the line unchanged (`cmduse/src/lib.rs:417`). `COLUMNS` is never read anywhere in `cmduse/src`. Measured: `COLUMNS=40 ocuse -1 --no-api` and `COLUMNS=200 ocuse -1 --no-api` produced byte-identical output (2,126 bytes, longest line 122 columns — the Monthly window line). With a real tty under 40 columns, `compact_frame()` (`cmduse/src/ocuse/cli.rs:196-199`) switches to the one-line `compact_line()` (`cmduse/src/ocuse/render.rs:757-787`) and drops the note and table entirely.

## 4. Ranked fix list

1. **OpenDesign identity** — `opencode-plugin/src/sidebar/od-rows-parts.ts:78-89`. The per-model value still carries the percentage, so the id is cut to ~16 columns. Apply the Go lane's pattern: value without the share, share as an indented continuation, id whole. Highest visual impact after the two reported Go strings.
2. **Deal badge and Plan value (Command Code)** — `opencode-plugin/src/sidebar/rows.ts:396-400`, `:491-500`. Both are unbounded strings, neither clipped nor wrapped. These are the only places where a row can silently grow past 37 with arbitrary upstream text.
3. **Model-name rows** — `opencode-plugin/src/sidebar/rows.ts:478`, `opencode-plugin/src/sidebar/zen.ts:589`, `opencode-plugin/src/sidebar/ark.ts:369`. Identity; keep `clip` only as a last resort, and surface the full id in a continuation when it clips.
4. **Diagnostic reasons** — `opencode-plugin/src/sidebar/rows.ts:406`, `opencode-plugin/src/sidebar/zen.ts:424`, `opencode-plugin/src/sidebar/ark.ts:312`. Prose, not identity. `wrap(text, valueWidth(""))` with 2 lines and the `complete` flag is appropriate; a reason that will not fit should be compacted, not ellipsed.
5. **ARK plan/profile and wallet reason** — `opencode-plugin/src/sidebar/ark.ts:299-302`, `opencode-plugin/src/sidebar/od-rows-parts.ts:40-42`. Split identity from suffix and wrap the suffix, or drop it as today but say why.
6. **Safe — leave alone**: all C-ranked numeric tokens, the fixed OpenDesign caveats (`opencode-plugin/src/sidebar/od-rows.ts:101-105`), `separator()` (`opencode-plugin/src/sidebar/rows.ts:45-48`), and the no-`clip` meter/period rows whose fields are bounded by `count()`/`brief()`/`until()`.

**One helper.** `wrap(text, width, maxLines)` already lives beside `clip` in `opencode-plugin/src/sidebar/rows.ts:55-104`. That placement is correct for all four families: `rows.ts` is the shared row primitive home (`clip`, `valueWidth`, `parts`, `windowRows` are all imported by `zen.ts`, `ark.ts`, `od-rows.ts` and `od-rows-parts.ts`), and it has no Command-Code-specific state. No rename needed. Only `zen.ts:33` imports it today; the other three families should import the same symbol. Add one more shared helper — `mutedWrap(rows, text, width, maxLines?)` — to `rows.ts` rather than duplicating the wrap-to-continuation loop now at `opencode-plugin/src/sidebar/zen.ts:299-303`; each family should also keep a compact fallback for `complete === false` as at `opencode-plugin/src/sidebar/zen.ts:536-546`. Keep `clip` for identities and fixed-width numeric tokens; use `wrap` only for prose.

**CLI.** No wrapper is needed for the one-shot dashboards (the terminal soft-wraps). If the clipped 110-char note in watch mode is in scope, wrap it before `redraw_frame()` at `cmduse/src/ocuse/render.rs:653-655` rather than changing `clip_to_width()` — that function is the whole-frame guard and its importance-order contract is documented at `cmduse/src/ocuse/render.rs:157-159`. The `arkuse` fixed 28-column id field (`cmduse/src/arkuse/render.rs:362-367`) is an overflow, not a truncation; size it like ocuse at `:657-667` if alignment matters.
