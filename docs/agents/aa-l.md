# lane L notes — throughput field priority and the last-good replay

Measured 2026-11-20, one tree, HEAD `f50ea9f` + this lane's uncommitted work.

## Facts that constrain future work

- **`outputSpeed` is one declared field order, not one number** (`src/sources/speed.ts`): API
  `performance.median_output_tokens_per_second` (rank 1) › page `outputSpeed` / `headline.outputSpeed` (2) ›
  `timescaleData.medianOutputSpeed` (3). Same model, same day: 229.62 (API, undated listing) vs 160.63 (page,
  `1017` build). Merging by `Math.max` silently switched series.
- **`Model.outputSpeedSource` carries which tier won** and is optional, so older fixtures and any stored row
  without it still typecheck. `takeSpeed` leaves an unknown tier ranked below every real one.
- **A merge keeps the incumbent on an equal tier.** That is what makes a last-good replay correct without a
  special mode: live groups merge first, the store is appended, so a replayed figure only wins where its tier is
  strictly better (which is the tier the failed source alone published).
- **`AA_CACHE_DIR` is the only way to test both stores** (`cacheDir()`), and the manifest fixture
  (`test/manifest/payload.bin`, sealed with `00112233…`) makes a *complete* load stubbable — a homepage that
  advertises `"manifest":{"path":"/data/fixture.txt","key":…}` is two lines of RSC.
- **A degraded run must not stamp either store.** Its age is what a later replay reports; a keyless run rewriting
  the store after a keyed failure would make the next replay look fresh.
- **`noCacheWrite` suppresses the replay too**, not just the writes: `aam check` passes it so the diagnostic
  cannot be repaired by the file it is meant to describe.

## Traps

- **The 429 is the API's free tier, not a bad key** — `{"error":"Rate limit exceeded"}`, and the API's last real
  answer is whatever its own last-good holds. Do not read "no API data" as "the series changed".
- **`dig(/outputSpeed/i)` matched `timescaleData.medianOutputSpeed`** through the case-insensitive alternative,
  which is how a chart aggregate could land in the documented median's slot. `readOutputSpeed` uses explicit
  paths; do not reintroduce a pattern search for this field.
- **mpc's `benchOf` still takes the max per key across models**, which is right: the undated listing (229.62) and
  the dated build (161.1) both answer to `deepseekv41flash`, and the row should show the best listing.
- **`tencent-hy4`'s store key is `hy4`** (vendor prefix stripped), and `tencent-hy3` has no speed at all — `hy3`
  is a separate model row. Match a stored row by its own slug key first, never by a shared alias.
- **A test that stubs only the pages makes the manifest absent, which counts as degraded** — that is why the
  store tests now stub the real manifest instead of asserting a write that a partial run must not make.

## Decisions

- Split `aa-models/src/sources/` rather than grow past 150 lines: `row.ts` (coercion + `walkEvals`), `speed.ts`
  (the order), `collect.ts` (source fan-out). `collapse` moved to `normalize.ts`.
- `LOADER_REVISION` 2, because the merge and a parser's output both changed.
- Docs: `oc-cmd-compare/README.md` and `AGENTS.md` rewritten around `@jeffreyjyz/aa-models`; `aa-models/README.md`
  still lacks `outputSpeedSource` (lane D's file).

## Not mine

- `aa-models/README.md` (Model shape) and the dead `~/.cache/mpc/aa-last-good.json` on disk.
