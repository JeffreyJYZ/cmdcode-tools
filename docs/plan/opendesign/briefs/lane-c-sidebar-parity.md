# Lane C — the sidebar's four families must show the same thing

## Why this exists

`opencode-plugin/src/sidebar/` renders four usage families side by side: `rows.ts` (Command Code), `zen.ts` (OpenCode Go/Zen), `ark.ts` (Volcengine ARK) and `od-rows.ts` + `od.ts` (OpenDesign). The repo rule is explicit — **"The sidebar sections stay at parity too"**: a row one builder shows, the others show unless the *source* makes it impossible, and then the reason lives in a code comment.

That rule has been asserted, not proven. Nobody has diffed the four builders field by field. This lane proves it and closes what it finds.

## The authoritative rule

Read these first, in this order:

1. `opencode-plugin/AGENTS.md` — the four-family section, including `isOpenDesignProvider` being a prefix match.
2. The root `AGENTS.md` section `## Consumers` and the sidebar parity bullets.
3. The four builders themselves: `src/sidebar/rows.ts`, `zen.ts`, `ark.ts`, `od-rows.ts`, `od.ts`, plus `data.ts` (the spawn layer) and `useRows.ts`.

Source-forced differences that are **correct today and must not be "fixed"**: `Tier` / `Min plan` and `Deal` are Command-Code-only because gating is CommandCode's; ARK and Go carry their own plan/window rows instead of a credit pool; OpenDesign has no gated view because a plan prices models differently rather than restricting them.

## What to produce

1. **A parity matrix** written to `docs/plan/opendesign/reports/lane-c-sidebar-parity.md`: one row per displayed field (label, spend, cap, percentage, window name, reset time, plan line, deal, tier, model rows, footer/source line, error row, empty state), one column per family. Each cell is `shown` / `absent (source)` / `absent (defect)`. For every `absent (source)` quote the line of code or the AGENTS rule that forces it — an unquoted "source makes it impossible" is exactly the excuse this lane exists to catch.
2. **Fix every `absent (defect)`** in the builder that should carry it. Keep the four builders structurally parallel: same helper names, same row shapes, same ordering, so a later change to one is visibly applicable to the others.
3. **Error-path parity.** `rows.ts::actionableAccountError` gates the failure row to reasons the user can fix, and `useRows.ts::keepAccount` carries the last good meters through a non-actionable failure so one dropped request cannot blink the panel. Check the other three have the equivalent: a transport fault must never blank a family's block, and a fixable fault (missing key/cookie/profile, 401/403) must say what to fix. Report per family which of those two behaviours exists.
4. **Empty-state parity.** `Show`-without-fallback once produced a zero-height crash. Confirm each family's empty/loading state renders a line rather than collapsing, and that the test asserting it exists on all four.
5. **Tests.** Every behaviour you change or prove gets a test in the matching `test/sidebar-*.test.ts` file. A claim in the matrix with no test behind it is a claim, not evidence — say so in the report where that is the case.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** everything under `opencode-plugin/src/sidebar/` and `opencode-plugin/test/sidebar-*.test.ts` (plus `opencode-plugin/test/od-fixture*.ts` if a fixture needs a field). **Do not touch** `opencode-plugin/src/index.ts`, `v2.ts`, `cli.ts`, `tui-commands.tsx`, `constants/providers.ts`, `test/plugin.test.ts`, `core/od.json`, `cmduse/**`, or `opencode-plugin/src/catalogOpenDesign.ts` — three sibling lanes own those this round and two writers on one file loses one change.
- Theme tokens are `text.base` / `text.muted`; a span needs `<span style={{ fg }}>` because `<span fg={…}>` is silently ignored; `mono()` must stay achromatic; colour is opt-in. Do not introduce a colour that ignores the flag.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Run every one in the foreground and wait for it inside the same call. A red gate is not a finished lane.

## Report

Append to `docs/plan/opendesign/reports/lane-c-sidebar-parity.md` as you go. Final chat reply under 15 lines: how many defect cells you found, what you fixed, the gate result, and anything left open with its reason.
