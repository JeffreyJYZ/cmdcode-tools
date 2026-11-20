# Lane G — cache identity, and `aa check` never reads the cache

Package `aa-models/` (`@jeffreyjyz/aa-models`). All four gates green; details at the bottom.

## The revision constant

`aa-models/src/sources/cache.ts`

```ts
export const LOADER_REVISION = "1";
export const CACHE_SCHEMA = "aa-models/2";
```

`LOADER_REVISION` is the hand-bumped one: its doc comment says to bump it whenever the merge in
`normalize.ts` or any parser's output changes, and says why (a cache carries no other proof of what wrote
it, so a repaired merge would otherwise keep serving the old, wrong catalogue for a whole TTL).
`CACHE_SCHEMA` moved from `aa-models/1` to `aa-models/2` because the payload gained fields; both are checked,
and a mismatch is **ignored and overwritten, never migrated**.

The payload now carries `{ schema, revision, version, fetchedAt, models, sources, indexVersion, notes }` —
`version` comes from `package.json` (`import pkg from "../../package.json" with { type: "json" }`), so the
file names the build that wrote it. One verdict function (`verdict`) decides usability, and both the reader
(`readCache`) and the reporter (`inspectCache` / `cacheNote`) use it, so what check prints cannot disagree
with what a run does.

`version` is carried and printed but does not gate usability: the brief's rule is revision or schema, and a
dev build changes parsers without changing the version.

## `aa check` bypasses the cache

`runCheck` now reloads with `cacheTtlMs: 0` whatever catalogue the dispatch handed it, and prints one line
naming the file a default run *would* use:

```
cache: /path/catalogue.json · 9m old · revision 1 (current 2) · ignored
```

The fixed first parameter keeps `run.ts`'s `runCheck(catalogue, options)` dispatch intact without editing
`run.ts` (lane D's file); the parameter is deliberately unused and documented as such.

## Before / after, poisoned cache present

Reproduced under `AA_CACHE_DIR=<temp>`, so the real cache was untouched. The forged file was exactly what
the pre-fix build left behind: `schema: "aa-models/1"`, no identity, 3 models, fresh `fetchedAt`.

Old reader's predicate on that same file:

```
old reader would serve: true -> 3 models
```

After the fix, a default run ignores it, refetches, and rewrites the file with a correct identity:

```
$ aa --rows 3
Claude Fable 5.2  Anthropic   64.6  108.7  1.0M  $8  $40  2026-11-09  closed
GPT-6.2 Astra     OpenAI      62.1   48.1  1.0M  $8  $40  2026-11-17  closed
Gemini 4 Neon     Google      61.4  109.9  1.0M  $3  $15  2026-11-18  closed
… 531 more

534 of 534 models · from manifest + leaderboard + models
```

Rewritten file: `{ schema: "aa-models/2", revision: "1", version: "0.1.0", models: 534 }`. A second run
serves it and says so: `note: cache: 534 models, just now old`.

The same file one line from the reporter's side:

```
cache: …/catalogue.json · just now old · schema aa-models/1 (current aa-models/2) · ignored
```

### The line's real job

A cache with the **current** identity but the wrong contents (closest to the incident: a bad build writing
under a good identity) is still served by a default run and still repaired only by a refetch:

```
$ aa --rows 3                       # forged: schema 2, revision 1, 3 models
3 of 3 models · from manifest
note: cache: 3 models, just now old

$ aa check
manifest     534 models
leaderboard  200 models
models       28 models
coverage       84 scored / 534 total
cache: …/catalogue.json · just now old · revision 1 · served
```

`served` is the reason: check's counts and the default run's counts differ, and the line names the file
that explains it.

## `aa check` output, poisoned cache present

Same forged file, made read-only (`chmod 400`) so the dispatch load cannot repair it before check inspects
it — with the network up and the file writable, the dispatch load rewrites it first and the line reads
`revision 1 · served` (see the wart below).

```
manifest     534 models
leaderboard  200 models
models       28 models
coverage       84 scored / 534 total
cache: /var/folders/…/catalogue.json · just now old · schema aa-models/1 (current aa-models/2) · ignored
```

`check --json` keeps the exact envelope (`schema`, `sources: [{name,count}]`, `indexVersion`, `fetchedAt`,
`stale`, `notes`, `total`, `scored`, `ok`); the cache line rides in `notes`, never as a new key.

`--cache 0` still bypasses and the line says `cache is off (--cache 0)`; `--refresh` still bypasses;
`--cache 15m` still bounds the TTL; `stale` and the last-good replay are untouched (`catalogue.test.ts`
still covers both, plus `--refresh`).

## Tests added

`test/sources/cache.test.ts` — a file this build wrote is served and labelled; a stale revision is ignored,
not migrated (reason names both); an older schema is ignored even with the right revision; a payload with no
models is never served; an empty catalogue is never written; a file older than the TTL is not served; no
file reads as absent, not as an error.

`test/cli/check.test.ts` — per-source counts; a valid cache a default run would serve is still not used by
`check` (asserts the injected loader was called once and the cached-only slug never appears); the line names
an ignored cache and why; exit 1 when no source produced a model. The two `aa check` tests that lived in
`test/cli/commands.test.ts` moved here.

## Gates (all foreground, all waited for)

```
bun test          → 115 pass, 0 fail, 328 expect() calls, 14 files
bun check         → ✓ No type errors in 43 files
bun fmt --check   → All 52 files are formatted
bunx biome lint   → exit 0 (one pre-existing info: biome.json schema pinned 2.6.7 vs binary 2.5.15)
```

Line counts against the 150 cap: `sources/cache.ts` 149, `cli/check.ts` 86, `cli/commands.ts` 102,
`test/cli/check.test.ts` 117, `test/sources/cache.test.ts` 96.

## Files touched

- `src/sources/cache.ts` (new) — identity, `readCache`, `writeCache`, `inspectCache`, `cacheNote`, `cachePath`.
- `src/sources/lastGood.ts` — the TTL cache moved out; keeps last-good, `cacheDir`, `ageLabel`, and its
  private write helper is now the exported `writeJson` both files share (no second implementation).
- `src/sources/index.ts` — imports the cache from `./cache.ts`; no behaviour change.
- `src/cli/check.ts` (new) — `runCheck` + `sourceRows`; created to keep `commands.ts` under the 150 cap.
- `src/cli/commands.ts` — re-exports `runCheck`/`CheckDeps`/`sourceRows` so `run.ts`'s import is unchanged;
  the check body left the file.
- `test/cli/check.test.ts` (new), `test/sources/cache.test.ts` (new), `test/cli/commands.test.ts` (check
  describes moved out).

Nothing in `oc-cmd-compare/**`, `cmduse/**`, `run.ts` or any README was touched.

## Known wart, for the coordinator

`aa check`'s **dispatch** load (in `run.ts`, lane D's file) still writes the cache when the TTL is non-zero,
so with the network up it repairs a poisoned file *before* `check` inspects it and the line then reads
`revision 1 · served`. The `ignored` verdict shows whenever nothing repaired the file — a unit call to
`inspectCache`, a network failure, or `--cache 0` (which says `cache is off`). Removing the side effect needs
a `noCacheWrite` flag on `LoadOptions` plus one line in `run.ts`, i.e. an edit outside this lane's scope.
