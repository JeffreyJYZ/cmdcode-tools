# Lane report — the sidebar must not imply headroom the plan does not grant

Branch state: `main`, HEAD `ee61977`, tree dirty by design (no commit, no branch, no stash).
Scope: `opencode-plugin/src/sidebar/**`, `opencode-plugin/test/**`.

## Step 0 — read state

- Legacy shape today: `caps.{monthlyUsd,weeklyUsd,fiveHourUsd,planModelCreditsUsd}` parsed in
  `src/sidebar/od.ts::parseOdJson` (one `OdCaps`), consumed by `od-rows.ts::odWindow` and
  `od-rows.ts::modelRows`.
- No per-model shape exists anywhere in the repo yet; the target shape is defined by
  `docs/plan/opendesign/briefs/canonical-caps.md`: `caps` keyed by model id with
  `{month, week, fiveHour}` plus a `defaultCaps` fallback.
- `od-rows.ts` hardcodes no cap number, but `modelRows` divides every model by
  `usage.caps.monthlyUsd`, which is exactly the 1.8x flattery the brief names.

## Step 1 — cap shapes parsed, one module per job

New `src/sidebar/od-caps.ts` (122 lines) owns both payload shapes:

- `parseCaps(raw)` detects by **shape**, never by a version field: a `caps` member holding
  `monthlyUsd`/`monthly` is the legacy flat block; the same member holding model-id keys is the
  per-model table; `defaultCaps` is read beside either. A nested `{caps: {caps: {...}}}` is
  unwrapped only when the inner object carries no window of its own, so one level of publisher
  drift cannot throw.
- `capSetFor(caps, modelId)` = own entry → `defaultCaps` → legacy headline.
- `capsAreHeadline(caps)` is true only for the legacy-only payload.
- Window spellings accepted on both sides: `month`/`week`/`fiveHour` and the legacy
  `monthlyUsd`/`weeklyUsd`/`fiveHourUsd`. A `null` 5-hour cap stays **absent**, never `0`.

`src/sidebar/od-window-caps.ts` (106 lines) owns the choice: candidates are de-duplicated by
**set identity**, not by model, so two models sharing `defaultCaps` are one denominator; the
window takes the lowest published figure for that window (the stricter allowance); only a
*different* figure is listed as an alternative, so `Flash caps (Flash $120)` cannot appear. A
window no set publishes returns `undefined` and the row disappears.

Both files sit under the 200-line cap; `od.ts` now returns `OdCapView`, and `capsAreHeadline`
replaced the old single `OdCaps` interface.

## Step 2 — the rows divide by the right denominator

`src/sidebar/od-rows.ts` (166) and its split-off `src/sidebar/od-rows-parts.ts` (129; the
period, the wallet and the per-model table, moved out at the 200-line cap):

- Every window now calls `windowCaps(caps, window, spendOf(usage, window))`, so the denominator
  comes from **the models that actually spent that window**, not from one global block.
- A continuation row under each meter names the set: `of $120 · Flash caps`, and on a mixed
  window `of $120 · Flash caps (Eco $220)`. A bare `$120` on the row is what used to read as
  the plan's headline; it no longer appears alone.
- `modelRows` takes a `capFor(model)` callback and divides **each row by that model's own**
  monthly allowance, so `deepseek-v4.1-flash` reads `$88/$120 (73.3%)` where it used to read
  `$88/$220 (40.0%)`.
- The `5h/7d cut locally` caveat is now decided by `publishes(caps, "fiveHour")` across every
  set, so a per-model plan without a 5-hour cap does not claim one.
- No cap literal exists in the sidebar: every figure is read from the payload.

## Step 3 — the legacy payload is marked, not trusted

When the JSON carries only the flat `caps` block, `capsAreHeadline` is true, every window is
drawn against it and each note reads `of $220 · headline allowance`. The row does not pretend to
be the model's meter, so a stale binary cannot read as exact. A payload with **no** cap set at
all gets one `no cap set published` caveat instead of silent zero rows. Both shapes parse with
no throw.

## Step 4 — tests

New `test/od-fixture-permodel.ts` (51) carries the arriving shape (`caps` keyed by model id with
`defaultCaps`) and a mixed-window variant; `test/sidebar-od-permodel.test.ts` (138) pins:

- per-model caps present → `$98.40/$120 (82.0%)` and `of $120 · Flash caps`;
- only legacy caps → `$1/$220 (0.5%)` and `of $220 · headline allowance`;
- both models in the window → the stricter `$120` wins and the caveat names both sets;
- a model with no entry falls to `defaultCaps`, not to the headline;
- a `null` 5-hour cap produces no 5-hour row and no zero denominator;
- malformed input yields no sets and no throw.

`test/sidebar-od.test.ts` and `test/sidebar-od-rows.test.ts` were updated to the `OdCapView`
shape (`usage.caps.legacy`, `capsAreHeadline`); no assertion was weakened — the legacy numbers
still pin 220/55/18.

## Step 5 — the sibling lane's shipped shape

That lane is now writing `capOverrides` (a list of `{id,label,models,monthlyUsd,…}` beside the
plan's flat block) plus top-level `capPicks` with one chosen set per window. `parseCaps` maps
each override's `models` ids to its set, takes the plan's own name from `defaultCapLabel`, and
`parsePicks` reads the CLI's per-window decisions; `applyPick` formats that decision instead of
re-deriving one that could disagree with the CLI. Two tests pin it: Flash's `$120` resolves from
`capOverrides`, and the shipped `capPicks` picks Flash over Eco with the alternative named
`Eco $220`. All three payload shapes (legacy, keyed per-model with `defaultCaps`, and the
shipped `capOverrides`/`capPicks`) pass in one fixture set.

## Gate

From `opencode-plugin/`, after the final edit:

- `bun test` — 322 pass, 0 fail (29 files)
- `bun check` — no type errors in 80 files
- `bun fmt --check` — all 89 files formatted
- `bunx biome lint` — exit 0
- `bun run build` — succeeded; `dist/` rebuilt and gitignored
- `package.json` PATCH bumped 0.5.33 → 0.5.34

Every changed file stays under the 200-line cap: largest is `od-rows.ts` at 188, then
`od-caps.ts` at 175. No commit, push, branch or stash; branch `main` at `ee61977`. Other
`cmduse/src/oduse/**` and `core/od.json` changes in `git status` are the sibling lane's work —
untouched here.
