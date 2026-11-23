# Lane R — the sidebar must say which percentage is which

Repo `/Users/jyz/dev/cmdcode-tools`, package `opencode-plugin/` (`@jeffreyjyz/opencode-command-code`, currently
0.5.39, pinned in `~/.config/opencode/opencode.json`).

## Why

`ocuse 0.8.6` now publishes, per account system, both figures plus the reason they differ:

```json
"account": { "monthly": {
  "percent": 76, "percentSource": "server", "serverPercent": 76,
  "currentCap": 100, "currentCapPercent": 69.9,
  "note": "the allowance changed during this period (DeepSeek V4.1 Flash 1017);
           the server meters 76%, today's cap implies 69.9%"
}},
"capChanges": []
```

The sidebar reads none of that. In `src/sidebar/zen.ts`:

- `zenMeterRows` (`:266-295`) prints `76% of limit · $70 local` and never says whether that is a blend or the
  endpoint's own number.
- the per-model block (`:427-444`) prints `${money(cost)}/${money(allowance)} (${pct}%)` — an unlabelled
  spend ÷ current cap, which is exactly the figure that reads as contradicting the meter above it.
- `note` and `capChanges` are dropped entirely.

Result on the user's screen: a 76% meter and a 70.0% model row, adjacent, with nothing explaining that one is
time-weighted and the other is today's cap. That is the reported bug, still live in the panel.

## Task

1. **Account meters**: keep the endpoint/blend figure as the percentage, and append its provenance in the
   existing muted style — `blended` when `percentSource === "blended"`, `server` when it is `"server"` (match
   the CLI's wording). Do not print a second percentage on that row.
2. **Per-model rows**: label the figure for what it is — at today's limit — inside the narrow value column:
   `$69.98/$100 · 70.0% now` (adjust to the width helpers this file already uses; never overflow). The point is
   that a reader cannot mistake it for the meter's denominator.
3. **Say why they differ**: when `account.monthly.note` is present, render it as one muted line clipped to the
   panel width, exactly as the CLI does. When `capChanges` is non-empty, render one muted line naming model,
   old → new and date (`limit $80→$100 on 2026-11-19`). Never invent a cap change when the array is empty.
4. **Parity**: check `rows.ts` (Command Code), `ark.ts` and `od-rows.ts` for the same unlabelled
   dollars/percent pair. Where their sources publish a cap, label it the same way; where a source publishes
   only a meter percentage, leave it and say so in the report. A row one family explains must not stay
   unexplained in the others unless its source makes it impossible.
5. **Tests** in `opencode-plugin/test`: the meter row carries `blended` for a blended payload and `server` for
   a server one; the model row reads `now` and never a bare `(70.0%)`; the note renders when present and
   nothing when absent; a `capChanges` entry renders the same day it happened. Keep them hermetic (fixture
   `ocuse --json` payloads, no spawn).
6. **Release prep**: bump `opencode-plugin/package.json` to `0.5.40`, run `bun run build` (the host loads
   `dist/`), and leave the version there for the coordinator to tag.

## Constraints

- Own: `opencode-plugin/src/sidebar/**`, `opencode-plugin/src/constants/**` if a new string belongs there,
  `opencode-plugin/test/**`, `opencode-plugin/package.json` (version only), and your two docs paths.
- **Do not edit `~/.config/opencode/opencode.json`** — the pin bump is the coordinator's, after publish.
- Do not touch `cmduse/**`, `core/**`, `oc-cmd-compare/**` or `aa-models/**`.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`, and never pass `-r` to `rg`.
- Gate, foreground: `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build`. No commit,
  no tag, no publish, no `AGENTS.md` (record notes in `docs/agents/percent-sidebar.md`).

Report to `docs/plan/percent-audit/lane-r.md`: the exact rendered strings for the user's payload (76 server,
100 cap, 69.9 now, note present, no capChanges), each test name, and the parity verdict per family.

## Report — lane R

Files changed (all uncommitted): `opencode-plugin/src/sidebar/zen.ts`, `opencode-plugin/test/sidebar-zen.test.ts`, `opencode-plugin/package.json` (0.5.39 → 0.5.40), plus the two docs paths (`docs/agents/percent-sidebar.md`, this file). `dist/` rebuilt locally (gitignored); `dist/index.js` carries `version: "0.5.40"`. Pin untouched. No commit, tag or publish.

### Exact rendered strings for the reported payload

Payload: `account.monthly` = 76, `percentSource: "server"`, `serverPercent: 76`, `currentCap: 100`, `currentCapPercent: 69.9`, note present, `capChanges: []`. A second model is present so the by-model block renders (the builder needs ≥2 rows). Strings are `parts(row).join("")`; `  ` is the muted continuation indent. Cap-in is time-relative, so it is shown as `…`.

```
Plan: Go · limits per model
5-hour: 12% of limit (server)
  20.0% elapsed · resets 4h
  $0.50 local
Weekly: 40% of limit (server)
  71.4% elapsed · resets 2d
  $1.50 local
Monthly: 76% of limit (server)                         <- the one percentage, basis named
  cap in … · resets 27d
  $69.98 local                                        <- dollars off the value, muted
  the allowance changed during this …                 <- note, clipped to 35 columns, muted
Period: 58 requests · $69.98
  by model · this month
deepseek-v…: $69.98/$100 · 70.0% now                   <- the current-cap figure, labelled
z-ai/glm-5.3-…: $1.50/$60 · 2.5% now
─────────────────────────────────────
Model: GLM 5.3 Flash
```

- Blended variant: the `Monthly` value reads `76% of limit (blended)`; nothing else changes.
- With one `capChanges` entry (`at` = 2026-11-19): one extra muted line `  limit $80→$100 on 2026-11-19`. With the array empty (the reported payload), no such line appears.
- `currentCapPercent` (69.9) is parsed but never printed on the meter row; the model row's `70.0% now` is its own `cost / limit` computation, which is the figure that used to read as a contradiction.

### Tests

New, in `test/sidebar-zen.test.ts` under `describe("the share's basis is named beside it")`:

1. `parseZenJson carries the meter basis, note and cap changes`
2. `the meter row carries server for a server payload`
3. `the meter row carries blended for a blended payload`
4. `the model row reads now, never a bare (70.0%)`
5. `the note renders when present and nothing when absent`
6. `an empty capChanges array invents no cap change`
7. `a capChanges entry renders the same day it happened`

Updated existing expectations in `describe("the account's own meters")`:

8. `per-model usage is listed like the console's Go page` — model values now end `now`
9. `the window rows carry the console share and a pair that divides to it` — basis on the value, local dollars asserted on a muted continuation
10. `a meter at its limit is flagged like an over-cap window` — `100% of limit (server)`

Hermetic: fixture `ocuse -1 --json` bodies, no spawn. `bun test` 370 pass / 0 fail.

### Parity verdict

- **Command Code (`rows.ts`)** — left unchanged. No account meter percentage exists there: `Monthly` is the sole credit-pool share and `cmdModelRows` prints money alone, so there is no second denominator to disambiguate.
- **ARK (`ark.ts`)** — left unchanged. `meterRows`' percent is the server's own meter share and its used/total are the server's own quota, so they divide to the same figure; local AFP already sits on a separate `local` continuation and `localRows` already prints `est.`. Labelling that percent `now` would misdescribe it.
- **OpenDesign (`od-rows.ts`, `od-rows-parts.ts`)** — left unchanged. No server meter exists; the block is headed `plan · estimate` with explicit local-cut caveats, so no second percentage can contradict it.
- None of the three sources publishes cap-change history, so the note/`capChanges` explanation cannot be reproduced there — the "source makes it impossible" case in the brief.

### Gate

Foreground, all green: `bun test` (370 pass), `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build`. `biome lint` reports one pre-existing info (`biome.json` `$schema` 2.6.3 vs CLI 2.6.8), exit 0. Reconnaissance memory at `docs/agents/percent-sidebar.md`.
