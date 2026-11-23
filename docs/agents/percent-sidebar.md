# Lane R — sidebar percentage disambiguation (recon/decision memory)

Scope: `opencode-plugin/` only. No commit, no tag, no publish, no `AGENTS.md` edit. Did not touch `~/.config/opencode/opencode.json` (coordinator bumps the pin after publish).

## What the bug was

`ocuse` 0.8.6 publishes a time-weighted monthly share and a separate current-cap figure. The Go/Zen sidebar showed one unlabelled meter percentage (`76% of limit · $70 local`) above an unlabelled per-model `spend ÷ today's cap` (`$69.98/$100 (70.0%)`). Same screen, two denominators, no explanation. The endpoint's number is the accurate one — never "fix" it by recomputing spend ÷ cap. See `docs/agents/percent-audit.md` for the framing correction.

## Decisions taken (and why)

- Meter basis goes **on the meter row's value** (`76% of limit (server)` / `(blended)`), not on a continuation: the deliverable requires "the meter row carries blended/server", so a separate muted line would be ambiguous. `(server)` matches the CLI phrase; `(blended)` carries the CLI's word.
- The local dollars moved from the main value to a muted continuation (`$69.98 local`). Reason: appending `(server)` to `76% of limit · $69.98 local` makes a 42-column row in a 37-column panel. Moving the dollars also stops them reading as the share's denominator.
- `currentCapPercent` is parsed but deliberately **not printed** on the meter row ("Do not print a second percentage on that row"). The per-model row independently computes its own `cost / limit`; that is the labelled `now` figure. Keep them separate.
- Cap-change line uses the lane's literal example shape, `limit $80→$100 on 2026-11-19`. The brief also says "naming model", but the example omits it, the CLI's own `allowance raised $80 → $100 during this period` omits it, and a full model id (e.g. `DeepSeek V4.1 Flash`) plus a date cannot fit 35 continuation columns. The date comes from `at` as a UTC `YYYY-MM-DD`, so it always renders. The note names the model when the payload has one.
- `ZenUsage.capChanges` is optional (hand-built `ZenUsage` literals exist in `test/sidebar-rows.test.ts`), but `parseZenJson` always returns `[]`.
- Nothing printed when `capChanges` is empty; no invented `$80→$100`.

## Parity verdict (files read, not changed)

- `rows.ts` (Command Code): no account meter percentage; `Monthly` is the sole credit-pool share, `cmdModelRows` prints money alone. No competing denominator. Left.
- `ark.ts`: `meterRows`' percent is the server's own meter share and its used/total are the server's own quota — they divide to the same number; local AFP is already on a separate `local` line, and `localRows` says `est.`. Labelling that percent `now` would be wrong. Left.
- `od-rows.ts` / `od-rows-parts.ts`: no server meter at all; the block is headed `plan · estimate` with explicit local-cut caveats. No second percentage to contradict. Left.
- None of the three sources publishes cap-change history (`docs/agents/percent-audit.md:23`), so the note/cap-change explanation cannot be reproduced: "source makes it impossible".

## Gate notes

`bun test` (370 pass), `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build` all green. `biome lint` prints an info about `biome.json`'s `$schema` 2.6.3 vs CLI 2.6.8 — pre-existing, exit 0. `dist/` is gitignored; build embedded version `0.5.40` in `dist/index.js`.

## Lane S — wrap, never truncate (2026-11-23)

- `wrap(text, width = ROW_WIDTH, maxLines = 2)` sits in `rows.ts` beside `clip`. It returns `{ lines, complete }`, breaks only at word boundaries, and never emits `…`. A single word wider than the width is hard-split, not truncated.
- The note wraps at `valueWidth("")` (35). If it cannot fit in two lines, the panel falls back to `limit changed mid-period` plus `<pct> <server|blended> · <now share>`. The CLI keeps the full sentence. The `now` share comes from `ranked[0]`, the row printed below — not from the active model, which differs when the session model is not the top spender.
- `capChangeLine` goes through the same wrapper. Neither the note nor the cap-change line uses `clip` any more.
- By-model rows: whole id as the label, money as the value, `X% now` on a muted continuation. `parts()` already indents continuations by two — the same width as `: ` — so the extra indent is the label's own length and the share lands under the value column. Clip the id only when the value leaves too little room, and then to that room.
- At the reported `$70.15/$100` (11 columns) the id budget is 24: `deepseek-v4.1-flash` (19) is the longest Go allowance id that survives; the two 26-column `muse-spark-*-contributor` ids survive when the value is short.
- Version `0.5.41`, `dist/` rebuilt (`dist/index.js` carries the string), pin untouched. Gate green: 375 tests, `bun check`, `bun fmt --check`, `bunx biome lint` (schema info only, exit 0), `bun run build`.
