# Lane K report — `mpc` consumes `@jeffreyjyz/aa-models`

## Part 1 — library entry (`aa-models` 0.1.1)

- `src/lib.ts` re-exports `loadCatalogue` and the types `Catalogue`, `LoadOptions`, `Model`, and nothing
  else. Relative imports, so it carries no reliance on the package's `#~` map and no CLI code.
- `package.json`: `exports` → `"."` = `./src/lib.ts`, `"./package.json"` = `./package.json`; `version` 0.1.1
  (0.1.0 elsewhere untouched). `bin` and `files` unchanged.
- `test/lib.test.ts` imports through the package name (`@jeffreyjyz/aa-models`, Bun's self-reference via
  `exports`) and runs `loadCatalogue({cacheTtlMs: 0, noCacheWrite: true})` against a stubbed `fetch` built
  from lane A's saved `initialModels` rows. Asserts models load, a known key is present, and the missing
  manifest is a note rather than a throw.
- README gained `## Use as a library` between Usage and Commands: the import plus a three-line example.

**Both resolution paths verified, not assumed:**

| path | check | result |
| --- | --- | --- |
| workspace | `bun install` → `oc-cmd-compare/node_modules/@jeffreyjyz/aa-models -> ../../../aa-models` | links |
| published tarball | `bun pm pack --destination <tmp>`, `tar tzf` | ships `package/src/lib.ts`, `package.json`, `LICENSE` |
| npm consumer | temp project + `bun add ./jeffreyjyz-aa-models-0.1.1.tgz` + `import("@jeffreyjyz/aa-models")` | `["loadCatalogue"]`, function |

Published `0.1.0` predates `lib.ts`, so `^0.1.1` only resolves from npm once the owner publishes — as the
brief expects.

## Part 2 — `mpc` off its private copy

Deleted `src/data/sources/aa/{api,flight,lastGood,leaderboard,parse,web}.ts` and added one adapter,
`src/data/sources/aa.ts`:

- `benchOf(catalogue)` is the pure map: every key in `model.keys` (the package's replacement for
  `aaKeyVariants`), best value per key wins (`>` against the current value), a `null` score or speed never
  enters a map, `indexVersion: null` becomes absent.
- `loadAa({apiKey})` calls `loadCatalogue({apiKey, cacheTtlMs: 0})` — the TTL cache stays out of the path
  (mpc prices live data every run); the package's last-good remains a failure fallback. It returns
  `{data, notes}` so the caller can show why a source degraded.

`bench/resolve.ts`:

- `aa-web` → `loadAa()` keyless, label `Artificial Analysis (web, N models, M speed)`.
- `aa` → still requires a key (`--aa-key`/`AA_API_KEY`; same message as before), then `loadAa({apiKey})`,
  which merges the API with the keyless sources in one load. The old last-good replay and the second
  `loadAaWeb()` fallback are gone: the package's merge already answers with whatever source is alive, and
  its notes are appended to the label (`— api: … 429 (daily quota spent …)`), preserving the old
  `API: <reason>` diagnosis.
- `loadAaFallback` → the same merged load, keyed or keyless (`how` = `AA API` / `AA keyless sources`).
- `file:`/`url:` schemes untouched.

`bench/index.ts` lost the `aa`-primary web fill (the primary is now already the merged catalogue), keeping
the CommandCode fill and `--no-fallback` behaviour. `bench/cc.ts` only changed its RSC decoder import.

`src/keys.ts` keeps `normalizeKey` **and** `aaKeyVariants`: `rg` shows `bench/cc.ts` still keys CommandCode's
flight rows through it, so deleting it would break CC slugs like `deepseek…-1017-high`.

Tests: deleted `test/data/{bench.test.ts,aa-leaderboard.test.ts,aa-web.html}` and
`test/unit/lastGood.test.ts` (the module it covered no longer exists). Added
`test/data/aa-adapter.test.ts` — a small `Catalogue` in, maps out: a model with two keys, a null score whose
speed still lands, best-value-wins across two models sharing a key, and index version present/absent.

## Acceptance

### `mpc --json --shape off` contract

Captured from HEAD (`22eca4a`) before any edit, then from the finished tree, and diffed:

```
top keys equal: true
rows before/after: 77 77
rows lost: (none)
rows gained: (none)
shape diffs: 0
```

`rows[].{key,name,oc,cc}` key sets and every row's field set are identical; only ability/tps **values**
moved.

### Three models, before → after

| model | ability before | ability after | tps before | tps after |
| --- | --- | --- | --- | --- |
| DeepSeek V4.1 Flash | 32.6 | 32.5896393532027 | 229.62 | 160.631334153574 |
| GLM-5.3 | 31.7 | 31.653381843882 | 72.85 | 73.0893423761818 |
| Tencent Hy4 | 34.6 | 34.5552385392508 | 97.57 | 93.1978302590923 |

"Before" was the API replaying its stored last-good (the live API answered 429 all session); "after" is the
package's keyless merge (manifest + leaderboard + models). Ability values are the same scores at full
precision instead of the API's one-decimal rounding; speed differs because the leaderboard and the API
publish different medians for the same model.

### `mpc --check`

| | before | after |
| --- | --- | --- |
| ability source | last good, 1h old (API 429) | 100 models, 120 speed (source coverage) |
| scores / speed in use | 59 / 55 | 59 / 31 |
| rows scored | 66/77 | 66/77 |
| note | filled 2 from AA web scrape, 23 from CommandCode | filled 23 from CommandCode |
| ability missing | same 11 keys | same 11 keys |

Source coverage grew (the manifest alone is 534 models, 84 scored; the old models-page scrape was a top-N), so
the label's counts are now larger than the pruned counts in the same line. That is the legitimate growth the
brief allows. The label also names the 429, the same diagnosis the old label carried.

### Gates (all foreground, all exit 0)

| command | verdict |
| --- | --- |
| `oc-cmd-compare`: `bun test` | 180 pass, 0 fail (28 files) |
| `oc-cmd-compare`: `bun check` | no type errors, 122 files |
| `oc-cmd-compare`: `bun fmt --check` | all 119 files formatted |
| `oc-cmd-compare`: `bunx biome lint` | exit 0; `Found 1 info` — pre-existing `biome.json` schema drift (expects 2.5.14, found 2.6.3) |
| `aa-models`: `bun test` | 118 pass, 0 fail (16 files) |
| `aa-models`: `bun check` | no type errors, 46 files |
| `aa-models`: `bun fmt --check` | all 55 files formatted |
| `aa-models`: `bunx biome lint` | exit 0; `Found 1 info` — same schema drift (2.5.15 vs 2.6.7) |
| root `bun install` | `Saved lockfile`; `bun.lock` committed below |
| root `bun parity` | `PASS parity check: 4 binaries, 30 flags, 13 allowed differences` |

## Deviations

1. **`src/data/bench/flight.ts` is new.** Deleting `aa/flight.ts` left `bench/cc.ts` without the Next.js RSC
   decoder its flight rows need, and lane K's brief allowed only the adapter; the decoder is not AA-specific,
   so it moved beside its last reader rather than being re-exported from the package (which the brief keeps to
   `loadCatalogue` + types).
2. **`test/unit/lastGood.test.ts` and `test/data/bench.test.ts` deleted.** Neither matches the brief's
   `*aa*` glob, but the first covers a module that no longer exists and the second tests only the deleted AA
   parsers; keeping either would be a test of nothing.
3. **`benchOf` is exported** so the adapter test is a pure map over a `Catalogue` (as the brief asks) instead
   of a network test.
4. **The adapter returns the package's `notes`** and `resolve.ts` appends them to the label, because otherwise
   a rejected/spent API key would silently cost coverage with no line saying so — the old label reported it.

## Findings for the owner

- **API-quota behaviour changed shape.** With the free tier spent (429, as today), the old code replayed
  `~/.cache/mpc/aa-last-good.json`; the package instead answers from the keyless sources, so 6 of 31 speed
  values blank (`musespark12`, `musespark13`, `hy3`, `gpt56luna`, `qwen38max`, `kimik3`) while ability keeps
  all 59. This matches mpc's documented "a source that is down costs its columns, never a stale value" rule,
  but it is the one capability the removed last-good had. If the stale replay is wanted, it needs a package
  option to accept stored rows (mpc-side store would re-introduce the file the brief deleted).
- **With a healthy key, coverage should exceed even the old API run** (API + manifest + pages merged), but
  that could not be verified today: every keyed call returned 429/401. Labelled expectation, not measured.
- **`bun.lock` also refreshed two stale entries that predated this work** — `aa-models` bins were recorded as
  `aa`/`aadev` (actual `aam`/`aamdev`) and `mpc` as 0.1.15 (actual 0.1.16). No version bump by me; mpc stays
  0.1.16.
- **Docs still describe the deleted layout.** `oc-cmd-compare/README.md` (`--bench` table + the "no cache"
  paragraph naming `data/sources/aa/web.ts`) and `oc-cmd-compare/AGENTS.md` ("Ability scores", "Sources and
  drift") are outside lane K's owned files; they need a follow-up so the docs name the package instead.
- **No tag, no publish, no `AGENTS.md` edit, no `mpc` version bump.**
