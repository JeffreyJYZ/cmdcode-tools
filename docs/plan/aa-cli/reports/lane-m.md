# Lane M report — the fallback store remembers its tier, and mpc's API payload is imported

Measured 2026-11-20 on the live machine, one tree on `refactor/mpc-aa-models` at HEAD `04d72bb` plus
the uncommitted work below. Nothing committed, no branch, no version bump, no tag, no publish, no
`AGENTS.md` edit (`AGENTS.md`'s `M` in `git status` is the coordinator's).

## 1. Store schema

`~/.cache/aa-models/last-good.json` (path unchanged) now carries its own identity, separate from the TTL
cache's `LOADER_REVISION`:

```json
{
	"schema": "aa-models/last-good/1",
	"revision": "1",
	"version": "0.1.1",
	"fetchedAt": 1795176471206,
	"models": [ /* Model[] — each speed beside outputSpeedSource: api | page | timescale */ ]
}
```

- `LAST_GOOD_SCHEMA` (`aa-models/last-good/1`) and `LAST_GOOD_REVISION` (`1`) live in
  `src/sources/lastGood.ts`, documented as "bump when what a stored model means changes". A file whose
  `schema` is present but different on either axis is ignored (never served, never migrated), the same
  rule the TTL cache uses.
- **A file with no `schema` is legacy**: it was written before `outputSpeedSource` existed, so its numbers
  came from the keyless pages alone. Those rows are tagged `page` on read (`tierOfLegacy`), never left as
  unknown, or a merge cannot rank them. The store on this machine had 96 page-tagged speeds and no
  untagged ones, so the rule is for other machines; it is pinned by a test.
- The tier rule (`offerSpeed` in `speed.ts`, now the single implementation behind `takeSpeed`) is what
  both merges use: a blank takes any figure, a better-ranked field replaces the incumbent, an equal rank
  keeps it.
- **Writing the store merges by tier** (`mergeStore`): the live rows are persisted with any better tier the
  previous store already knew, so a keyless run can no longer overwrite an api-tier median with a page
  aggregate. Live wins an equal tier, so a page figure still refreshes normally. Only live rows are
  written — the store never accumulates models the live sources dropped.
- A healthy run also overlays those better tiers on what it returns, which is what makes
  `aam --json` show the API series on a keyless machine. `stale` stays `false` (the run is live) and each
  row names its provenance in `outputSpeedSource`.

## 2. mpc's pre-package API store

`src/sources/mpcStore.ts` (new) reads `~/.cache/mpc/aa-last-good.json` —
`{ fetchedAt, intelligence: [key, score][], tps: [key, speed][] }` — with `readFile` only. It is never
rewritten, never deleted (verified: mtime `2026-11-20T10:11:50Z` and all 439 speeds + 169 scores intact
after every run below).

- `importMpcStore` runs on a persist load **only when neither the run nor the store already holds an
  api-tier speed**, so it fires once and every later run skips the read. `aam check` (`noCacheWrite`) never
  touches it.
- Values are joined through `model.keys` and enter as `api`; a score fills a blank only. A model answering
  several legacy keys takes the largest of them, which is mpc's own key-level max (`benchOf`) — see the
  boundary in §6.
- The note is printed once, by the run that did it:
  `migrated 244 api-tier speeds and 6 scores from /Users/jyz/.cache/mpc/aa-last-good.json`. It is not
  written into the TTL cache, so a cached replay of that catalogue does not claim a second migration.
- A degraded run repairs the store and keeps the store's own `fetchedAt`, so a replay still reports an
  honest age; a healthy run stamps it as usual.
- `AA_LEGACY_DIR` overrides the legacy directory (default `$XDG_CACHE_HOME/mpc`, else `~/.cache/mpc`), and
  every test that loads a catalogue points it at a temp dir — a test must never read the real
  `~/.cache/mpc`.

## 3. Live proof

`aam`'s bin maps to `aa-models/src/index.ts`; no `aam`/`aamdev` link is installed on this machine, so the
command below is that bin's own entry point.

```
$ bun run aa-models/src/index.ts --refresh --json --model deepseek-v4.1-flash
# first run after the change, store still page-tier:
notes: ["migrated 244 api-tier speeds and 6 scores from /Users/jyz/.cache/mpc/aa-last-good.json"]
deepseek-v4-1-flash       outputSpeed=229.62  outputSpeedSource=api

$ bun run aa-models/src/index.ts --json --model deepseek-v4.1-flash
notes: [ "cache: 534 models, 1m old" ]
deepseek-v4-1-flash       outputSpeed=229.62  outputSpeedSource=api
deepseek-v4-1-flash-1017  outputSpeed=229.62  outputSpeedSource=api
```

```
$ mpc --json --shape off
deepseekv41flash  DeepSeek V4.1 Flash  cc.tps=229.62  oc.tps=229.62
hy4  Tencent Hy4  cc.tps=97.57  oc.tps=97.57
glm53  GLM-5.3  cc.tps=72.85  oc.tps=72.85
```

Before, same commands, same machine: `160.631334153574` (page), `93.1978302590923`, `73.0893423761818`.

The store cannot go backwards any more — a keyless live refresh, whose pages publish 160.63, leaves it at:

```
after a keyless live refresh (pages publish 160.63): { speed: 229.62, src: "api" }
```

## 4. Tests

`test/sources/store.test.ts` (new): a tierless store reads as `page`; a store this build wrote keeps its
tier; another schema/revision is ignored; a page-tier live figure never replaces a stored api-tier one and
vice versa; only live rows are written, with a stored figure filling a blank; the legacy shape is read and
joined by key; a missing or malformed legacy file is `undefined`; an equal-tier value already present is
never replaced by the legacy one; `hasApiSpeed`.

`test/sources/migration.test.ts` (new): first load imports the payload into the returned catalogue and the
store, keeps the legacy file byte-identical, and the next run prints no note and writes an identical
`models` array (idempotent); a malformed or absent legacy file is a no-op; a cached replay does not
re-announce the migration; a degraded run repairs the store without restamping `fetchedAt`.

`test/sources/{catalogue,replay}.test.ts`: `AA_LEGACY_DIR` is pinned to a temp dir so the real store is
never read.

## 5. Gates (foreground, both exit 0)

| command | verdict |
| --- | --- |
| `aa-models`: `bun test` | 134 pass, 0 fail (20 files) |
| `aa-models`: `bun check` | no type errors, 55 files |
| `aa-models`: `bun fmt --check` | all 64 files formatted |
| `aa-models`: `bunx biome lint` | exit 0; `Found 1 info` — pre-existing schema drift (2.6.7 vs 2.5.15) |
| `oc-cmd-compare`: `bun test` | 180 pass, 0 fail (28 files) |
| `oc-cmd-compare`: `bun check` | no type errors, 126 files |
| `oc-cmd-compare`: `bun fmt --check` | all 119 files formatted |
| `oc-cmd-compare`: `bunx biome lint` | exit 0; same schema-drift info |

Every touched file is ≤150 lines (`index.ts` 130, `lastGood.ts` 141, `mpcStore.ts` 124).

## 6. Deviations and boundaries

1. **`cache.ts`: `LOADER_REVISION` 2 → 3, not in the brief's explicit list but inside my file set.** Its
   docblock requires a bump when the merge changes, and it did: a served catalogue now carries the overlay.
   Without it a revision-2 file written by the previous build serves page-tier figures for a whole TTL —
   exactly what made the first verification run print 160.63 from a warm cache.
2. **The migration note is kept out of the TTL cache** (`notes: live.notes` on that write), so "once" holds
   even for a cached replay. Everything else about that cache is unchanged.
3. **A model answering several legacy keys takes the largest**, reproducing mpc's key-level max. Consequence
   visible on this machine: the dated listing `deepseek-v4-1-flash-1017` reports `229.62` (the family's
   undated API key) rather than its own `161.1`. The undated row, and every number the brief asks for, are
   exact. If the owner wants each dated listing to keep its own figure, the fix is "first key match" in
   `applyMpcStore` and one store re-import.
4. `aa-models/README.md` still documents only `AA_API_KEY` and `AA_CACHE_DIR`; it needs one line for
   `AA_LEGACY_DIR` and the store's `schema`/`revision`. It is not my file.
5. `oc-cmd-compare/AGENTS.md` says mpc "no longer keeps `~/.cache/mpc/aa-last-good.json` — reading it would
   re-introduce the file the move deleted". Still true of the adapter; the **package** now imports it once,
   read-only. That sentence needs a clause so a future reader does not delete the file.

## 7. Age phrasing

The cache line read `cache: 534 models, just now old`; `agePhrase` (`src/sources/lastGood.ts`) is now the one
formatter for both the cache line and the replay label — `just now`, `12m old`, `3h old`, `2d old` — while
`ageLabel` stays a bare bucket for `older than the TTL (3h)`. Pinned in `test/sources/cache.test.ts`; live,
`aam` prints `cache: 534 models, just now` and `cache: 534 models, 2m old`.
