# Lane A notes — sources, model record, catalogue load

Measured 2026-11-20 against `artificialanalysis.ai`. These are the traps the next lane
should not rediscover.

## What AA publishes today (live shapes)

- **`/leaderboards/models`** — RSC `initialModels`, **287 rows**, richest keyless source for
  scalars: `release{slug,name}`, `name`, `shortName`, `suffix`, `isReasoning`, `isOpenWeights`,
  `contextWindowTokens`, `intelligenceIndex`, `scores{…}` (nested evals), `price1mInputTokens`,
  `price1mOutputTokens`, `outputSpeed`, `timeToFirstToken`, `modelCreatorName`.
  Rows carry **no own `slug`** — identity is `release.slug`, and the effort variant is `suffix`
  ("Max, Default Fallback"), so a leaderboard model's variant slug is its identity.
- **`/models`** — RSC `initialModels`, only **28 rows**, but the only keyless source with
  `headline.outputSpeed` / `headline.timeToFirstToken`, `price1mBlended0To3To1` (AA's published
  3:1 blend), `inputModality*` / `outputModality*` booleans, and nested `capabilities`,
  `gdpvalInterval`, `intelligenceIndexCost`, `workloads`.
- **`/api/v2/language/models/free`** — needs `x-api-key`; keyless answers **401**
  `{"error":"API key is required"}`. Row shape `{name, slug, evaluations.artificial_analysis_intelligence_index,
  performance.median_output_tokens_per_second}`, envelope `{pagination:{page,page_size,total_pages,has_more}, data:[…]}`
  with `intelligence_index_version` in-band. No key on this machine, so the API fixture is that
  documented shape pinned inline in the tests, not a captured page.
- **Manifest** (lane B) — 762 rows collapse to **534 identities**, **84 scored**; the 146 numeric
  rows are effort variants of ~84 releases.

## Traps

- **An effort label is never a join key.** Registering `effort.label`/`suffix` ("xhigh", "high",
  "max") in `keys` makes every family share a key: measured 534/84 → **384/42** after the merge,
  and `gpt-6-sol` carried 35 foreign keys. Keys come from `aaKeyVariants` over the identity slug
  and the display names only (single digits in practice).
- **A shared key attaches another source's figures; it must not fold two rows one source already
  listed apart.** AA lists every dated build as its own row (`deepseek-v3-2` vs `deepseek-v3-2-0925`).
  Merge by key only when the two models do not already share a source, or the manifest loses ~59
  rows. Fixed in `mergeModels` via `sharesSource`.
- **`timeToFirstToken` is seconds, wall-clock, reasoning included** — AA's own order, not ms.
  `claude-opus-5-5` (Max effort) reads **368.9 s** on the leaderboard and **631 s** on its own
  models-page 1k workload. Equal to `timeToFirstAnswerToken`. Do not rescale.
- **`bun fmt` reflows an HTML fixture** into a JS array with single quotes, which `decodeFlight`
  no longer matches (the test then passed only through the raw-text fallback). Fixtures are JSON
  row sets and `test/sources/page.ts` rebuilds the real `push([1,"…"])` chunk at test time.
- **A keyless run is fully usable**: 534 models, 84 scored, 96 with speed, 94 priced, 200 with a
  context window. Only `indexVersion` is null without the API.

## Design decisions

- Shared bounded GET lives in `src/sources/api.ts` (`fetchText`) because lane A's file list has no
  `http.ts`; `leaderboard.ts` imports it. One retry on a network fault, never on an HTTP status.
- `src/sources/index.ts` resolves `./manifest.ts` through a **non-literal dynamic import** so the
  package type-checks and runs before lane B lands; absence is a note, never a crash.
- Cache (TTL) and last-good (failure fallback) both live in `lastGood.ts`; `index.ts` only
  orchestrates. Neither ever persists an empty model set.
- `evals` paths keep their parents (`capabilities.financeAndAccounting`, `gdpvalInterval.lower`,
  `intelligenceIndexCostPerTask.total`, `scores.aa-briefcase`). Top-level AA fields stay flat
  because AA itself publishes them flat (`score`, `omniscienceAccuracy`).
- `Model.raw` always holds the first contributing record; serializers must drop it unless `--raw`.
  After a cross-source merge it holds the earlier source's record, so `evals` can carry paths the
  raw row does not (documented, not a bug).
