# Lane C — sidebar four-family parity

## Method

Diffed the four builders field by field: `rows.ts` (Command Code), `zen.ts` (Go/Zen), `ark.ts` (ARK), `od-rows.ts` + `od.ts` (OpenDesign), with `data.ts`, `useRows.ts` and `panel.tsx` as the shared plumbing. Every `absent (source)` cell quotes the forcing line or rule. Every `absent (defect)` was fixed, then re-gated. Rule read first: `opencode-plugin/AGENTS.md` §"The sidebar's four families" and root `AGENTS.md:83` ("a row one shows, the others show unless the _source_ makes it impossible, and then the reason lives in a code comment").

## Parity matrix

Legend: `shown` / `absent (source)` / `absent (defect) → fixed`.

| Field | Command Code | Go / Zen | ARK | OpenDesign |
| --- | --- | --- | --- | --- |
| Label / Plan headline row | shown — `rows.ts:333` `["Plan", …, "base", true]` | `absent (defect) → fixed` — `zen.ts:313` had no `true` headline flag; now matches | shown — `ark.ts:298-305` `["Plan", …, "base", true]` | shown — `od-rows.ts:94` `["Plan", …, "base", true]` |
| Spend (Period line) | shown — `rows.ts:363` `["Period", parts.join(" · "), "base"]` | shown — `zen.ts:419` | shown — `ark.ts:335` | shown — `od-rows.ts:150` |
| Window cap | shown — `rows.ts:243` rejects `cap <= 0` | shown — `zen.ts:228` `limit * share`; spend alone below it (`zen.ts:229-231`) | shown — `ark.ts:240`, `ark.ts:274` | shown — `od-rows.ts:63-64`, model-dependent caps (`od-rows.ts:37-40`) |
| Percentage | shown — `rows.ts:245` | shown — `zen.ts:276-293` (console share) | shown — `ark.ts:231-232` | shown — `ark.ts`-shared `windowRows` via `od-rows.ts:67` |
| Window names 5h / weekly / monthly | shown — `rows.ts:357-358` | shown — `zen.ts:347-377` | shown — `ark.ts:317-324` | shown — `od-rows.ts:114-148` |
| Daily window | `absent (source)` — `rows.ts:357-358` draws only `5-hour` and `Weekly` | `absent (source)` — `zen.ts:347-377` draws only three meters | shown — `ark.ts:319-321` `meterRows("Daily", …)` | `absent (source)` — `od-rows.ts:114-148` draws only the three published caps (`od-rows.ts:43-44` "a window the plan does not publish produces no row at all") |
| Reset / countdown | shown — `rows.ts:252` `until(w.resetAt…)` | shown — `zen.ts:203-206` `rollingReset` and `zen.ts:374` period end | shown — `ark.ts:242`, `ark.ts:276` | `absent (source)` for 5h/week — `od.ts:14` "the 5-hour and 7-day cuts are this machine's own (there is no per-window usage API)"; Monthly shown — `od-rows.ts:146` `period?.resetAt` |
| Plan line | shown — `rows.ts:333` | shown — `zen.ts:313` | shown — `ark.ts:296-305` | shown — `od-rows.ts:94` |
| Deal | shown — `rows.ts:399-406` | `absent (source)` — root `AGENTS.md:83` "Source-forced, therefore CC-only: `Tier`/`Min plan` … and `Deal`" | same AGENTS quote | same AGENTS quote |
| Tier / Min plan | shown — `rows.ts:392-396` | `absent (source)` — root `AGENTS.md:83` "gating is CommandCode's" | same AGENTS quote | `absent (source)` — brief §17 "OpenDesign has no gated view because a plan prices models differently rather than restricting them" |
| Active-model headline | shown — `rows.ts:386` | shown — `zen.ts:448` | shown — `ark.ts:369` | `absent (source)` — `od.ts:6` "there are no cache tokens and no per-session dimension"; OD draws a by-model table instead (`od-rows-parts.ts:68`) |
| Model spend row | shown — `localUsageRows` at `rows.ts:290-301` | shown — `localUsageRows` at `zen.ts:451` | shown in AFP — `ark.ts:370-377` `"AFP (this model)"`; dollar `Session` row `absent (source)` — `ark.ts:5-7` "ARK meters in AFP, not money" | `absent (source)` — `od.ts:6` "no per-session dimension" |
| Model rates / benchmarks | shown — `rows.ts:402-416` | shown — `zen.ts:460-471` (`oc.rates`, `ability`, `tps`) | `absent (source)` — `ArkModel` at `ark.ts:43-49` carries only `coef` + AFP totals | `absent (source)` — `od.ts:13` "the store records no cache tokens, so every credit figure prices input and output only" |
| By-model table | `shown` — lane F closed this cell; `cmduse model --json` is a documented stable contract, not a source limit. `loadCmdModels` in `data.ts` spawns it behind a minute TTL and `cmdModelRows` in `rows.ts` draws the same top-3 block. See `lane-f-cmd-by-model.md`. | shown — `zen.ts:431-443` | `absent (defect) → fixed` — `ArkUsage.models` was parsed (`ark.ts:133-144`) but never ranked; now `ark.ts:353-364` | shown — `od-rows-parts.ts:68-92` |
| Footer / source line | `absent (source)` — `od-rows-parts.ts:34-35` "`profile`/`user`/`source` are dropped: they identify the account rather than measure it" | same quote; `source` parsed at `zen.ts:149` but never rendered | same quote | same quote (the rule is stated in `od-rows-parts.ts`, applies to all four) |
| Error row (fixable reason) | `absent (defect) → fixed` — `usageRows` now draws `rows.ts:339-340`; `requireSnapshot` passes fixable reasons (`data.ts:83`) | shown — `zen.ts:318-319` | shown — `ark.ts:311-312` | `absent (source)` — no account API with keys/401; the equivalent wallet reason is shown at `od-rows-parts.ts:41` `no meter · ${usage.walletError}` |
| Empty / loading state | safe — builders return `[]` on no snapshot; shared `panel.tsx:156` `fallback={<box height={0} />}` | same | same | same |

## Error-path parity

| Family | Transport fault never blanks | Fixable fault says what to fix |
| --- | --- | --- |
| Command Code | yes — `data.ts:83` throws on a transport fault, `useRows.ts:341` catch keeps `lastSnapshot`; new `keepUsage` carries the reason only. Test: `sidebar-data.test.ts` "rejects the errored defaults", `sidebar-session.test.ts` "a failed Command Code poll keeps the last meters". | yes after fix — `rows.ts:339-340` draws `usage API: HTTP 401 api_key_expired` under Plan. Test: `sidebar-rows.test.ts` "a fixable account error rides under Plan". |
| Go / Zen | yes — `useRows.ts:328` `keepAccount(await loadZen(…), lastZen)`; test `sidebar-session.test.ts` "a dropped request keeps the last account meters". | yes — `zen.ts:318-319`; test `sidebar-zen.test.ts` "a named reason rides directly under Plan". |
| ARK | yes — `useRows.ts:333` `keepAccount(await loadArk(), lastArk)`; same `keepAccount` test. | yes — `ark.ts:311-312`; test `sidebar-ark.test.ts` "without an account answer the rows are this store's AFP alone". |
| OpenDesign | yes — `loadOd` throws on a missing store and `useRows.ts:276-282, 341` catch keeps `lastOd` (`useRows.ts:184-186`). | n/a (source) — no key/cookie/profile/401 concept; `od.ts:72` `walletError` is surfaced as `od-rows-parts.ts:41`. Test: `sidebar-od-rows.test.ts` "the wallet is a balance on its own row, and a closed app is one dim line". |

## Empty-state parity

All four builders return `[]` when their snapshot is undefined (`rows.ts:328`, `zen.ts:310`, `ark.ts:294`, `od-rows.ts:85`). The shared `Panel` guards `<Show>` with `fallback={<box height={0} />}` (`panel.tsx:156`), so a cold start paints a zero-height box instead of throwing `Orphan text error`. New test in `sidebar-panel-empty.test.tsx` renders the empty panel under all five `panelTitle` values (`Command Code`, `OpenCode Go`, `OpenCode Zen`, `Volcengine ARK`, `OpenDesign`) and asserts no throw and no text; the guard against over-correction still asserts a one-row panel paints its title.

## Defects fixed

1. **Command Code never named a fixable failure.** `requireSnapshot` threw on every `error`, so `usageRows` could never draw one, and the panel kept a stale snapshot with no explanation (an expired key looked like healthy credits). `data.ts:83` now throws only for non-actionable errors; `useRows.ts` `keepUsage` keeps the last meters and carries the reason; `rows.ts:339-340` draws the row under Plan with the shared `actionableAccountError` gate. Same helper, row shape and placement as Zen/ARK.
2. **ARK parsed per-model AFP but never ranked it.** Added the `by model · this period` table (`ark.ts:353-364`), top three by month AFP, same `clip`/`Math.max(4, …)` width guard and `ranked.length > 1` rule as Zen/OD. No percentage column: `arkuse` publishes no per-model quota, so the row carries the AFP figure alone.
3. **Zen's Plan row was not a headline.** `zen.ts:313` lacked the fourth `true` slot used by the other three, so the panel drew it plain while the section title and every other family's Plan were bold. Added `true`; three exact-row assertions in `sidebar-zen.test.ts` updated.

## Tests added

- `sidebar-rows.test.ts`: exact `actionableAccountError` whitelist; fixable row under Plan vs silent transport fault.
- `sidebar-data.test.ts`: `requireSnapshot` passes a fixable reason through untouched.
- `sidebar-session.test.ts`: `keepUsage` keeps last meters and only the reason.
- `sidebar-ark.test.ts`: ranked by-model table, full model names fit width, and no dangling heading for one model.
- `sidebar-panel-empty.test.tsx`: empty first paint for all five titles.

## Gate

`bun test` 329 pass / 0 fail (1334 assertions); `bun check` no type errors in 80 files; `bun fmt --check` all 89 files formatted; `bunx biome lint` exit 0 with one pre-existing info (`biome.json` `$schema` 2.6.3 vs CLI 2.6.7 — config owned by no lane this round, not touched).

## Left open

- No family renders a source/footer line; parity holds, and the two families that parse account identifiers deliberately drop them. Not changed.
- Several builders already exceed the repo's 200-line cap before this lane (`rows.ts`, `zen.ts`, `ark.ts`, `useRows.ts`). This lane kept changes additive inside the existing split; restructuring them is a separate refactor.

## Closed after this report — lane F

Lane F closed the last open parity cell: Command Code's by-model table. The `absent (source)` call was wrong — `cmduse model --json` is a documented stable contract (`{source, since, models:{id: totals}}`), not a missing field in the `-1 --json` snapshot. It is now `shown`. The matrix cell above and the removed "Left open" bullet reflect that; details and the gate are in `lane-f-cmd-by-model.md`.
