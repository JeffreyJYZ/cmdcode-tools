# Lane F — the sidebar's Command Code block has no by-model table

## Why this exists

Lane C's parity matrix found exactly one parity cell left open, and named it honestly rather than papering over it:

- `zen.ts` renders `by model · this month` (top rows, width-guarded).
- `ark.ts` renders `by model · this period` (added by lane C).
- `od-rows.ts` renders per-model rows with each model's own cap set.
- `rows.ts` renders **only the current session's model**. There is no per-model block.

The rule is "a row one shows, the others show unless the *source* makes it impossible". Lane C believed the source made it impossible because cmduse's `-1 --json` snapshot carries no per-model field — and that part is true. But it is **not impossible**, it is a second call: `cmduse model --json` is a stable documented contract (root `AGENTS.md`, the `## Consumers` table: `cmduse model --json [--since ISO]` → `{source, since, models:{id: totals}}`), and it already returns exactly the shape the other three tables use.

So the honest classification for this cell is `absent (defect)`, not `absent (source)`. Close it.

## The authoritative reference

1. Root `AGENTS.md`: the sidebar parity bullets, and the `## Consumers` table rows for `cmduse model --json` and `mpc --json --shape off`.
2. `docs/plan/opendesign/reports/lane-c-sidebar-parity.md` — the matrix and the open-cell entry you are closing. Read it first.
3. `opencode-plugin/src/sidebar/{zen,ark,od-rows}.ts` — the three existing by-model blocks. Copy their shape, not a new one.
4. `opencode-plugin/src/sidebar/data.ts` — the spawn layer (`loadUsage`, `loadZen`, `loadArk`, `loadOd`), plus `SIDEBAR_OPTS` and the TTL/caching convention.

## What to build

1. **A `loadCmdModels()` in `data.ts`** that spawns `cmduse model --json` through `runCmduse`, with:
   - a TTL cache exactly like `loadArk`'s (a second spawn per 5 s poll is a cost, not a feature) — key it by the same string the other loaders use for their plan/scope where one applies, and say why the key is a constant if it is;
   - a last-good keep on failure, so a dropped request cannot blink the block (the same behaviour `keepAccount` gives the meters);
   - a **skip guard**: `cmduse model --json` returns an empty `models` map when the window holds no local turns (verified: `--days 1` and `--days 7` both return `{}` on this machine while `--days 120` returns 5 models). An empty map must render as *nothing added*, never as an empty table or a zero-height block.
2. **A by-model block in `rows.ts`**, structurally parallel to `zen.ts`'s and `ark.ts`'s: the same `by model · <window>` muted header wording, the same top-N cap, the same width guard, the same ordering (biggest spend first, name as tiebreak, matching `by_spend` in the Rust side).
3. **`useRows` wiring** — spawn it for the Command Code family only, keyed the way the other families are, and never for a session whose provider is one of the other three. Confirm `isOpenDesignProvider`-style prefix matching is not misapplied here.
4. **Tests** in `test/sidebar-rows.test.ts` (and `test/sidebar-data.test.ts` for the loader): the block renders when the map is non-empty; it is absent when the map is empty; it survives a loader failure with the last good rows; the header and ordering match the other two builders; the width guard clamps exactly as they do.
5. **Update the lane-C matrix** — change that cell from `absent (defect)` to `shown`, and note in `lane-c-sidebar-parity.md` that lane F closed it, so the report is not left claiming a gap that no longer exists.

Do not change the other three builders' output while doing this. If you find they disagree with each other on wording or ordering, fix the *disagreement* by picking the wording the majority already use, and say which one you normalised.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `opencode-plugin/src/sidebar/rows.ts`, `opencode-plugin/src/sidebar/data.ts`, `opencode-plugin/src/sidebar/useRows.ts` (wiring only), `opencode-plugin/test/sidebar-rows.test.ts`, `opencode-plugin/test/sidebar-data.test.ts`, and the lane-C report. **Do not touch** `index.ts`, `v2.ts`, `cli.ts`, `tui-commands.tsx`, `constants/providers.ts`, `test/plugin.test.ts`, `core/od.json`, `cmduse/**`, `catalogOpenDesign.ts`, or the `zen.ts` / `ark.ts` / `od-rows.ts` builders — a sibling lane may still be reading them.
- Theme tokens are `text.base` / `text.muted`; a span needs `<span style={{ fg }}>`; `mono()` stays achromatic; colour stays opt-in.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`, foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-f-cmd-by-model.md`. Final chat reply under 15 lines: what you added, the empty-map and failure cases, the gate result.
