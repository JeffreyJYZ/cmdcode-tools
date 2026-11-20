# Lane A — model record + live sources (leaderboard, models page, API)

Read `docs/plan/aa-cli/contract.md` first; it fixes the record, `loadCatalogue()` and the file list. Your
job is the sources half, ported from code that already works.

## What exists to port (read, do not modify)

`oc-cmd-compare/src/data/sources/aa/`:

- `flight.ts` — decodes a Next.js page's streamed RSC payload (`self.__next_f.push([1,"…"])`) and
  bracket-matches the JSON array under a key. Pure, no I/O. Move it over unchanged in behaviour.
- `leaderboard.ts` — `parseAaLeaderboard(html)`: the AA leaderboard page's `initialModels` array carries far
  more rows than `/models`, keyed by `release.slug` first. Best score per key wins; a null index means
  listed-but-unmeasured, never 0.
- `parse.ts` — `parseAaApi(body)`: one API page; reads `intelligence_index_version` in-band, digs for the
  index and tokens/second with a recursive number search, and registers every key variant so effort
  variants answer to the same model.
- `api.ts` — `loadAaApi(key)`: `GET https://artificialanalysis.ai/api/v2/language/models/free?page=N&page_size=200`,
  `x-api-key` header, follow `pagination.has_more`, cap the pages, merge best-per-key. The status hints are
  load-bearing: 401 bad key, 402/403 needs Pro, 404/410 retired path, 429 quota spent.
- `lastGood.ts` — last-good **failure fallback** (not a TTL cache): written only after a successful fetch
  with scores, read only when the live call throws, and labelled with its age so a stale replay is never
  mistaken for live data. An empty answer is never written.
- `oc-cmd-compare/src/keys.ts` — `aaKeyVariants()` (registers the raw key plus the date-stripped and
  effort-stripped forms, only when a 3–4 digit bake date is present), `normalizeKey()`, `displayName()`.
  Copy the three functions into `src/sources/keys.ts`; do not import across packages yet.

## What is new

1. `src/model.ts` — the record from the contract, plus a normalizer that turns one upstream row into a
   `Model`: identity by slug, `variants` collapsing effort rows that share a release slug, `evals` walking
   the raw record for every finite scalar under a stable dot-path, `keys` from `aaKeyVariants`. Keep it pure.
2. `src/sources/normalize.ts` — merging: slug first, then a shared join key; never let a lower score
   overwrite a higher one; union `sources`; union `keys`; take the first non-null for a scalar.
3. `src/sources/index.ts` — `loadCatalogue()` per the contract: manifest (lane B's `loadManifest`) leads,
   then leaderboard, then API when keyed. Per-source failure is a `notes` line, never a blank list. Cache
   read/write here: one JSON file under `AA_CACHE_DIR`, TTL from options, never persist an empty set,
   never serve the cache when `refresh` is set, and say in `notes` when a cached copy was used.
4. `src/sources/lastGood.ts` — same semantics, path under `AA_CACHE_DIR`.

## Evidence you must produce

- `test/sources/` fixtures: one saved leaderboard HTML (trim the flight payload to a few rows if it is
  huge — the fixture must still be the real encoding), one saved API page, and unit tests over the pure
  parsers: a null index stays null; an effort variant folds into its base slug; a dated slug answers to
  both keys; a higher score wins; a page with `has_more` is followed.
- A live run to prove it against reality (not in the test suite):
  `timeout 120 bun -e 'import {loadCatalogue} from "./src/sources/index.ts"; const c = await loadCatalogue({cacheTtlMs:0, ...}); console.log(c.models.length, c.sources, c.indexVersion, c.notes)'`
  from `aa-models/`. Quote the counts. If `AA_API_KEY` is absent, say so — the keyless path must still
  return a usable list.
- Report to `docs/plan/aa-cli/reports/lane-a.md`.
