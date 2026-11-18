# Lane F — the Command Code by-model table

## What was added

Closed the last parity cell from `lane-c-sidebar-parity.md`: Command Code now renders a `by model · this month` table like Go/Zen, ARK and OpenDesign. Lane C had called it `absent (source)` because the `-1 --json` snapshot carries no per-model field. That is true but not forcing: `cmduse model --json` is a documented stable contract (`{source, since, models:{id: totals}}`), so the data needed a second spawn, not a missing feature.

- `data.ts`: `cmdModelsArgs()` (`model --json --plain`, no window flag — the CLI's own period is the one the account block describes), `parseCmdModelsJson()` (lifts `models` keyed by id, spend from `costUsd`, not `cost`), `keepCmdModels()` (last-good helper), and `loadCmdModels()` with a minute TTL cache and a constant `"default"` key. The key is a constant because no caller selects a profile, tier or window — exactly why `loadArk` uses the same constant. A future window flag invalidates by changing the key, not by adding a cache.
- `rows.ts`: `CmdModelUsage` / `CmdModels` types and `cmdModelRows()`. Structurally the Zen/ARK block: muted header, top three, same `Math.max(4, ROW_WIDTH - value.length - 2)` clip with the value's room reserved, `ranked.length > 1` rule. Ordering is the CLI's own `by_spend` — biggest `costUsd` first, model id as the byte-order tiebreak (`report_render.rs:430-441`), not `localeCompare`.
- `useRows.ts`: `refreshCmdModels()` is called only for `kind === "ours"` (the `PROVIDER_ID_PREFIX` branch in `sessionKind`, not `isOpenDesignProvider`), fire-and-forget so a missing second CLI cannot cost the store-backed rows at the end of the tick. Module-level `lastCmdModels` + `rememberCmdModels`/`seededCmdModels` seed the table across remounts and session switches. Rows go between `usage()` (Period) and `separator()`, the same position Zen/ARK use.

## Two traps handled

- **Empty map.** `cmduse model --json` returns `{}` when the window holds no local turns (verified here: `--days 1` and `--days 7` both `{}`, `--days 120` returns five models). `cmdModelRows()` returns `[]` for an empty, absent or single-model map — no header, no zero-height block. An empty map is also never remembered, so it cannot wipe a good one.
- **Spawn cost / dropped request.** The minute TTL in `loadCmdModels` means the 5 s poll spawns `cmduse model` about once a minute, not once a tick. On failure the `.catch` calls `keepCmdModels(undefined, lastCmdModels)` and the last good map stays on screen, the same rule `keepAccount` gives the meters; a genuine answer wins even when it is empty (the table then drops out honestly).

## Normalisation

The three existing by-model blocks disagreed on the header wording (`by model · this month` in `zen.ts`, `by model · this period` in `ark.ts`) and on the clip expression (Zen reserves one extra column, ARK has an explicit min-4 floor). This lane did not touch either builder — sibling lanes were still reading them — so the new table takes Zen's `this month` wording (the Command Code window *is* the month) and ARK's clamped form for the width guard. No existing output changed.

## Tests

- `test/sidebar-rows.test.ts`: shared header/order/top-3 shape, byte-order tiebreak, empty/absent/single-model maps add nothing, long-id clip fits `ROW_WIDTH`, and the header row equals Zen's for equivalent models.
- `test/sidebar-data.test.ts`: real `costUsd` shape, empty-window `{}`, malformed body, stable args with no window flag, and last-good keep on a dropped load (the rendered rows survive) with a real empty answer winning.

`docs/plan/opendesign/reports/lane-c-sidebar-parity.md`: the By-model table cell is now `shown`, the stale "Left open" bullet is gone, and a short note records that lane F closed it.

## Gate

`bun test && bun check && bun fmt --check && bunx biome lint` in `opencode-plugin/`: 339 pass / 0 fail (1359 assertions), no type errors in 80 files, all 89 files formatted, biome lint exit 0 with one pre-existing info (`biome.json` `$schema` 2.6.3 vs CLI 2.6.7 — config owned by no lane this round, not touched). Foreground, waited on inside the call.
