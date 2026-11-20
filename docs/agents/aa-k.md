# lane K notes — `mpc` on `@jeffreyjyz/aa-models`

Measured 2026-11-20, one tree, HEAD `22eca4a`.

## Facts that constrain future work

- **`@jeffreyjyz/aa-models` now has `exports`** (`"."` → `src/lib.ts`, `"./package.json"`), so the package
  name resolves inside its own tests (Bun self-reference) and from a real `bun add <tarball>` install. The
  tarball ships `src/**`, so the entry works from npm as shipped — no build step.
- **`lib.ts` deliberately re-exports only `loadCatalogue` + `Catalogue`/`LoadOptions`/`Model`.** Adding an
  RSC decoder or a parser there to save a local module would make mpc import the package's internals; the
  brief keeps this surface minimal.
- **mpc's `normalizeKey` and the package's key normalizer carry the same `ALIASES` table** (verified field by
  field). `model.keys` is therefore directly comparable to a row key; a new alias must be added on both
  sides or the model silently reads unscored in `mpc`.
- **`aaKeyVariants` must stay in `oc-cmd-compare/src/keys.ts`.** `data/bench/cc.ts` still keys CommandCode's
  flight rows with it; only AA's use of it moved into the package.
- **`src/data/bench/flight.ts` is the last RSC decoder** (`decodeFlight`/`readArray`). CommandCode's docs
  embed `"models"` in the same `self.__next_f.push` payload, so it is not AA-specific.
- **The adapter's `benchOf` maps every `model.keys` entry and keeps the max**, because the package merges
  sources already but two Models can still share a key; `null` never enters a map.
- **`cacheTtlMs: 0` is load-bearing.** Any non-zero value lets the package's TTL cache answer, which
  contradicts mpc's no-cache rule; `noCacheWrite` is left at its default so the package's last-good failure
  fallback still writes.

## Traps

- **`--bench aa` with a spent quota no longer replays mpc's last-good.** The package merges keyless sources
  instead, so API-only speeds blank (6 of 31 on 2026-11-20: `musespark12`, `musespark13`, `hy3`, `gpt56luna`,
  `qwen38max`, `kimik3`). The label names the 429. Ability coverage is unaffected.
- **Label counts are source coverage, not used coverage.** `ability (100 models, 120 speed)` counts every
  scored/speedy key in the catalogue; the parenthesised `59 scores, 31 speed` beside it is post-`prune`.
  A future reader must not treat the first pair as the values feeding VAL.
- **`--no-fallback` skips `prune`** (pre-existing), so its check line reports the unpruned counts.
- **API values are not leaderboard values.** Same model, same day: DeepSeek V4.1 Flash tps 229.62 (API
  last-good) vs 160.63 (leaderboard). Ability is identical at full precision vs the API's rounded 32.6 — do
  not read the precision change as a score change.
- **The keyless package path reads `timescaleData.medianOutputSpeed`** through `dig`'s case-insensitive
  `outputSpeed` match, but the models page is only a top-N, so a model absent from it has no keyless speed.

## Decisions

- Deleted mpc's `aa/` directory wholesale; the adapter lives at `src/data/sources/aa.ts` and the RSC decoder
  at `src/data/bench/flight.ts` rather than inside `cc.ts` (two reasons to change).
- `resolve.ts` appends the package's `notes` to the ability label: without it a 401 looked like working data.
- Deleted `test/data/bench.test.ts` and `test/unit/lastGood.test.ts` in addition to the brief's `*aa*` globs;
  both covered only deleted modules.

## Not mine

- `oc-cmd-compare/README.md` and `oc-cmd-compare/AGENTS.md` still describe `data/sources/aa/*` and a
  "no cache" benchmark layer. They need a follow-up by whoever owns those files.
