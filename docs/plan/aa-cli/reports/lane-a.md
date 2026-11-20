# Lane A report — model record, sources, `loadCatalogue`

## Delivered (`aa-models/`)

| file | purpose |
| --- | --- |
| `src/model.ts` | `Model`/`Release`, `normalizeRow`, `normalizeRows` (effort-variant folding) |
| `src/sources/keys.ts` | `normalizeKey`, `aaKeyVariants`, `displayName` ported from mpc |
| `src/sources/flight.ts` | `decodeFlight`, `readArray`, plus `initialModels(html)` |
| `src/sources/leaderboard.ts` | pure parsers for both keyless pages + `loadLeaderboard()` |
| `src/sources/api.ts` | bounded `fetchText`, `parseAaApi`, `loadAaApi` (pagination, status hints) |
| `src/sources/normalize.ts` | scalar extraction, `evals` walker, `mergeModels` |
| `src/sources/lastGood.ts` | cache dir, TTL cache, last-good fallback |
| `src/sources/index.ts` | `loadCatalogue()` |
| `test/sources/{parsers,merge,catalogue}.test.ts`, `page.ts`, `fixtures/*.json` | offline tests over real captured rows |

## Gates (run in the foreground, from `aa-models/`)

```
bun test test/sources   → 27 pass, 0 fail, 85 expect() calls (3 files)
bun test                → 105 pass, 0 fail (12 files, whole package)
bun check               → ✓ No type errors in 39 files
bun fmt --check         → All 48 files are formatted
bunx biome lint         → Checked 47 files, Found 1 info (lane D's biome.json pins
                          schema 2.6.7 while the CLI is 2.5.15 — not an error, not my file)
```

Line cap: `model.ts` 150, `sources/normalize.ts` 150, `sources/index.ts` 137,
`sources/lastGood.ts` 97, tests 146/132/87/21.

## Live proof (no key on this machine — `AA_API_KEY` absent)

```
bun -e 'import {loadCatalogue} from "./src/sources/index.ts";
        const c = await loadCatalogue({cacheTtlMs: 0}); …'
```

`sources/manifest.ts` was already on disk when this ran, so the full chain answered:

```
models=534 scored=84 speed=96 priced=94 context=200
sources=manifest,leaderboard,models  indexVersion=null  stale=false  notes=0
```

Manifest alone, same run: **534 models / 84 scored**. The two keyless pages (198 collapsed models,
68 scored) added no new identity but filled **speed 96, price 94, context 200**, so the merge
behaves as designed: manifest leads, web enriches. `indexVersion` is null only because the API
needs `AA_API_KEY`; the keyless path is fully usable.

## The three reported defects

1. **Effort labels in `keys` — real, fixed.** `keys` now comes from `aaKeyVariants` over the identity
   slug, AA's row slug and the display names; the effort label feeds `reasoning.efforts` only.
   Measured after the fix: `loadCatalogue` → **534 models / 84 scored** (was 384/42), and
   `gpt-6-sol` has **2 keys** (`gpt6sol`, `gpt6soldaybreakblue`) instead of 35.
   A second, related over-merge was also fixed: shared-key merging now only attaches a *different*
   source's figures, so AA's own dated builds (`deepseek-v3-2` vs `deepseek-v3-2-0925`) stay two
   rows. That is what makes the count 534 rather than ~475.
2. **`evals` paths — no flat collapse reproduced; pinned instead.** Every nested object keeps its
   parent: `capabilities.financeAndAccounting` 38.926, `gdpvalInterval.lower`,
   `intelligenceIndexCostPerTask.total`, `scores.aa-briefcase` 1739.19, `headline.outputSpeed`.
   `gpt-6-sol`'s keys that look flat (`score`, `omniscienceAccuracy`, `hleDiamond`) are AA's own
   top-level fields in the manifest — its real path is the bare name. A parity check walking each
   raw record produced **0 path mismatches across the 534 manifest models**. New test
   `nested scalars keep their parent in the eval path` pins it. One honest caveat: after a
   cross-source merge `evals` is the union, so a model whose `raw` came from the manifest can carry
   `scores.*`/`capabilities.*` paths from the absorbed page row — namespaced, not collapsed.
3. **`latency: 275` — settled as seconds, not a unit slip.** AA's own payloads: leaderboard
   `timeToFirstToken` for `claude-sonnet-5-5` (Max) is **275.16**, and for `claude-opus-5-5` (Max)
   **368.86**; the same model's models-page workload reads **631.03 s at 1k**. AA measures
   wall-clock to the first visible token, so reasoning time is inside it, and the value equals
   `timeToFirstAnswerToken`. Nothing is rescaled; the finding is recorded in a comment beside the
   field and in `docs/agents/aa-a.md`.

## Deviations worth knowing

- **No API page could be captured** (keyless is 401). The API fixture is the documented row/envelope
  shape pinned inline in `test/sources/parsers.test.ts` (`parseAaApi`) and in `catalogue.test.ts`
  (the stubbed paginated loader), not a saved live page. Say so plainly rather than pretending it
  is a capture.
- **Shared HTTP helper lives in `sources/api.ts`** — lane A's file list has no `http.ts`, so the
  bounded GET (20 s, one network retry, never on a status) sits with the API loader and
  `leaderboard.ts` imports it.
- **`./manifest.ts` is imported through a non-literal dynamic import** in `sources/index.ts`: the
  package type-checked and ran before lane B landed, and a missing/broken loader is a `notes` line
  instead of a crash. Kept as the fail-soft boundary after it landed.
- **Fixtures are JSON row sets**, and `test/sources/page.ts` rebuilds the real
  `self.__next_f.push([1,"…"])` chunk at test time. A saved HTML file is reflowed by `bun fmt` into
  single-quoted JS, which silently stops exercising `decodeFlight`.
- `test/sources/page.ts` is the one file I added beyond the listed test glob (`test/sources/*`)
  and the fixture dir; `test/sources` holds 4 entries + `fixtures/` (3 files).
