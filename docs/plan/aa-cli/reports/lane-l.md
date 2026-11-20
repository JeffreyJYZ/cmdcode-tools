# Lane L report — throughput field priority, last-good replay, docs

Measured 2026-11-20, one tree at HEAD `f50ea9f` + the uncommitted work below. Nothing committed, no branch,
no version bump, no tag, no publish, no root `AGENTS.md` edit (its `M` in `git status` predates this lane).

## 1. Which field produced each throughput figure

| source | field for `deepseek-v4-1-flash` | value |
| --- | --- | --- |
| manifest | none — the decrypted payload has no speed key for this model (`outputSpeed: null`, `sources: ["manifest"]`) | — |
| leaderboard page | top-level `outputSpeed`, one row per effort variant | `152.760976895847` (Non-reasoning), `164.594178228929` (High), `160.631334153574` (Max) |
| models page | `headline.outputSpeed` (the Max row; **no** `timescaleData` in today's payload) | `160.631334153574` |
| API | `performance.median_output_tokens_per_second` | **unmeasurable today**: `GET .../api/v2/language/models/free -> 429 {"error":"Rate limit exceeded"}` |

The API's own last recorded answer is in mpc's pre-move store
(`~/.cache/mpc/aa-last-good.json`, `fetchedAt` 2026-11-20T10:11:50Z, written only by the pre-move keyed API
loader): `deepseekv41flash = 229.62`, `deepseekv41flash1017 = 161.1`. So `229.62` is the **API series** for the
undated listing and `160.63` is the **page series** for the `1017` build: two different measurements of one
model family, which is exactly why taking the max across them was wrong.

Verdict on "did the true API figure move to 160.63?": **not observed, and the evidence says no.** The API's
recorded value today is 229.62 for the undated listing; 160.63 is the page's number for the dated build. The
free tier is 429 until reset, so the API's current value for either listing cannot be measured today — that
boundary is stated rather than papered over.

### What changed

- `aa-models/src/sources/speed.ts` (new) declares the order once, with the justification in the docblock:
  1. `api` — `performance.median_output_tokens_per_second`. The only field AA documents by name on the data
     API: one named series at full precision, and the figure mpc has always shown for a keyed run.
  2. `page` — `outputSpeed` (leaderboard row) / `headline.outputSpeed` (models page row). The chart series both
     keyless payloads carry; an aggregate AA re-bakes per effort variant, so a fallback only.
  3. `timescale` — `timescaleData.medianOutputSpeed`, the models page's older chart aggregate, kept so a payload
     that still carries it is not blank.

  `readOutputSpeed` reads that order; `takeSpeed` keeps a better-ranked field over the incumbent and leaves an
  equal rank alone, so the merge never maxes two series.
- `aa-models/src/model.ts` populates `outputSpeed` + a new `outputSpeedSource` (`"api" | "page" | "timescale" |
  null`, optional so no other lane's fixture breaks) from `readOutputSpeed`; its old
  `dig(/median_output_tokens_per_second|output_speed|outputSpeed/i)` — which matched
  `timescaleData.medianOutputSpeed` through the `outputSpeed` alternative — is gone.
- `aa-models/src/sources/normalize.ts` `absorb` calls `takeSpeed` instead of `higher(into, from)`.

### Proof

Live pages fetched at 19:38 local (`curl` with the package's UA), decoded with the package's own
`initialModels`:

```
{"name":"DeepSeek V4.1 Flash 1017 (Non-reasoning)","idx":18.51,"speed":{"outputSpeed":152.760976895847}}
{"name":"DeepSeek V4.1 Flash 1017 (High)","idx":28.64,"speed":{"outputSpeed":164.594178228929}}
{"name":"DeepSeek V4.1 Flash 1017 (Max)","idx":32.59,"speed":{"outputSpeed":160.631334153574}}
models.html: {"slug":"deepseek-v4-1-flash-1017","name":"... (Max)","speed":{"headline.outputSpeed":160.631334153574}}
```

`aam --json` with the keyed call 429ing, replaying a prepared last-good (see §2 for how it was prepared):

```
stale True total 534 sources ['manifest','leaderboard','models','api']
note: api: GET https://artificialanalysis.ai/api/v2/language/models/free?page=1&page_size=200 -> 429 (daily quota spent, use the keyless sources)
note: last good, 23m old
deepseek-v4-1-flash       speed=229.62            from=api   idx=None
deepseek-v4-1-flash-1017  speed=161.1             from=api   idx=32.5896393532027
glm-5-3                   speed=72.85             from=api   idx=31.653381843882
tencent-hy4               speed=97.57             from=api   idx=34.5552385392508
```

`mpc --json --shape off --bench aa` against the same store:

```
musespark12 Muse Spark 1.2  cc.tps=285.96  oc.tps=285.96
musespark13 Muse Spark 1.3  cc.tps=329.73  oc.tps=329.73
deepseekv41flash DeepSeek V4.1 Flash cc.tps=229.62 oc.tps=229.62
hy4  Tencent Hy4   cc.tps=97.57  oc.tps=97.57
glm53 GLM-5.3      cc.tps=72.85  oc.tps=72.85
hy3  Tencent Hy3   cc.tps=79.12  oc.tps=79.12
gpt56luna GPT-5.6 Luna cc.tps=136.43 oc.tps=136.43
qwen38max Qwen 3.8 Max cc.tps=43.35 oc.tps=43.35
kimik3 Kimi K3     cc.tps=45.01  oc.tps=45.01
```

### Before / after, all three models

| model | before the move (mpc, API last-good) | after, page sources only | after, this lane |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash | 229.62 | 160.631334153574 | **229.62** |
| GLM-5.3 | 72.85 | 73.0893423761818 | **72.85** |
| Tencent Hy4 | 97.57 | 93.1978302590923 | **97.57** |

The "page sources only" column is the regression: `aam --json` into an empty cache dir with the API 429ing, which
is what the previous tree did. GLM is the case that proves the field rule rather than mere replay — its page
figure is *higher* (73.09) than its API figure (72.85), so `max` would still have changed it; the declared order
restores 72.85.

## 2. The six blank speeds

`loadCatalogue` only read last-good when **every** source failed, so a 429 that still left the keyless pages
working blanked whatever the API alone had published. Wired now (`aa-models/src/sources/index.ts`):

- `collectSources` (new `src/sources/collect.ts`) returns `degraded` — true when a source that should have
  answered did not (manifest, either page, or the API when a key was given).
- `degraded` + a stored last-good ⇒ the catalogue is rebuilt as `mergeModels([...liveGroups, stored.models], true)`:
  blanks are filled, a model only the API listed comes back, and the tier rule above means a replayed API figure
  still outranks a live page aggregate while a live figure of the same tier is never replaced.
- The run reports `stale: true` and pushes `last good, <age> old` into `notes` (mpc appends `notes` to its
  ability label, so the footer reads `… -> 429 (daily quota spent …); last good, 24m old`).
- A degraded run writes neither store, so the age a later replay reports stays honest. `writeLastGood` still
  refuses an empty list, and `cacheTtlMs: 0` keeps only the TTL cache out of the path — the fallback still works.
- `noCacheWrite` now also suppresses the replay: it is what `aam check` passes so the diagnostic describes the
  store instead of being repaired by it.

### Proof

Prepared last-good: mpc's pre-move API store (a real 10:11 UTC API response) mapped onto the package's own
catalogue rows by exact slug key (`deepseek-v4-1-flash` ← `deepseekv41flash`, `…-1017` ← `deepseekv41flash1017`,
`tencent-hy4` ← `hy4`; date-stripped key only as a fallback), written to a throwaway `AA_CACHE_DIR`. Values are
the API's, not invented: `musespark12 285.96`, `musespark13 329.73`, `hy3 79.12`, `gpt56luna 136.43`,
`qwen38max 43.35`, `kimik3 45.01`; 242 models carried an API figure in total.

```
$ AA_CACHE_DIR=<tmp>/cache aam --json --aa-key <key>   # API answers 429
stale True
note: api: ... -> 429 (daily quota spent, use the keyless sources)
note: last good, 23m old
muse-spark-1-2  speed=285.96  from=api
muse-spark-1-3  speed=329.73  from=api
tencent-hy3     speed=None    from=None       (recorded on slug `hy3`; mpc reads key `hy3` = 79.12)
gpt-5-6-luna    speed=136.43  from=api
qwen3-8-max     speed=43.35   from=api
kimi-k3         speed=45.01   from=api
```

All six keys are present in `mpc --json` (shown above), and the prepared store file was byte-identical after the
run (`readFileSync` compare) — a partial run does not stamp it. An empty cache dir stayed empty: no empty store,
no TTL cache from a degraded run.

Tests pinning this: `test/sources/replay.test.ts` (quota fill + note age + store untouched, tier rule both ways,
API-only model returns, total failure replays) and `test/sources/catalogue.test.ts` (a healthy run writes both
stores; a cache hit touches no network).

## 3. Docs

- `oc-cmd-compare/README.md`: the `--bench` table now says `aa` = API + keyless, `aa-web` = manifest + both pages
  (every listed model, scores/speeds partial); the prose names `@jeffreyjyz/aa-models`, the declared throughput
  order with the 229.62-vs-160.63 example, `cacheTtlMs: 0`'s narrow meaning, and the package's last-good
  (`~/.cache/aa-models/last-good.json`, `AA_CACHE_DIR`) as a failure fallback that labels its age.
- `oc-cmd-compare/AGENTS.md`: layout now says `aa.ts (AA through @jeffreyjyz/aa-models)` and `bench/… flight.ts`;
  the "Ability scores" block was rewritten around the package (adapter contract, `model.keys`, pagination, free
  list, deleted `aa/*` modules, the field order + `outputSpeedSource`, `cacheTtlMs: 0`, last-good semantics); the
  stale "no cache in any layer (benchmarks included)" line and mpc's own `aa-last-good.json` references are gone.

No reference to `src/data/sources/aa/{web,api,parse}.ts` or `~/.cache/mpc/aa-last-good.json` remains in either file
(`rg` over both).

## Gates (foreground, both exit 0)

| command | verdict |
| --- | --- |
| `aa-models`: `bun test` | 120 pass, 0 fail (18 files) |
| `aa-models`: `bun check` | no type errors, 52 files |
| `aa-models`: `bun fmt --check` | all 61 files formatted |
| `aa-models`: `bunx biome lint` | exit 0; `Found 1 info` — pre-existing `biome.json` schema drift (2.6.7 vs 2.5.15) |
| `oc-cmd-compare`: `bun test` | 180 pass, 0 fail (28 files) |
| `oc-cmd-compare`: `bun check` | no type errors, 125 files |
| `oc-cmd-compare`: `bun fmt --check` | all 119 files formatted |
| `oc-cmd-compare`: `bunx biome lint` | exit 0; same schema-drift info |

Every file in both packages is ≤150 lines (`wc -l`), tests included.

## Deviations

1. **Three new modules in `aa-models/src/sources/`**, because `model.ts` and `normalize.ts` were already at the
   150-line cap and the change adds behaviour: `row.ts` (the row coercion guards + `walkEvals`, moved out of
   `normalize.ts`), `speed.ts` (the declared order + `takeSpeed`), `collect.ts` (the per-source fan-out + lazy
   manifest loader, moved out of `index.ts`). `collapse` moved from `model.ts` to `normalize.ts` (it is merging,
   not identity). Each file now has one reason to change.
2. **`aa-models/src/sources/cache.ts`: `LOADER_REVISION` 1 → 2.** Its own docblock requires a bump when the merge
   or a parser's output changes, and both did; without it a 1 h TTL cache would serve the old figures. Not in the
   brief's file list, but leaving it would be the bug it exists to prevent.
3. **Test files**: `test/sources/live.ts` (shared stubbed AA: manifest fixture + both pages + API), the `api page`
   block moved from `parsers.test.ts` to `api.test.ts`, and the replay/priority tests in `replay.test.ts`. The
   `catalogue.test.ts` fixtures now include the real encrypted manifest so "a healthy run writes both stores"
   still exercises a complete load.

## Findings for the owner

- **`aa-models/README.md` is now one field behind**: it documents `Model` without `outputSpeedSource` and without
  the declared throughput order. It is lane D's file, so it is untouched — it needs one paragraph.
- **The API's current throughput series is unmeasurable until the free tier resets.** 229.62 is the API's own
  number from 10:11 UTC today, so the replay is evidence, not a guess; if AA re-measures the series later, the
  next successful keyed run writes the new number and wins by rank, no code change.
- **`~/.cache/mpc/aa-last-good.json` is now dead** (nothing reads it after this lane). Left on disk; deleting
  user state is not mine.
- **`tencent-hy3` is stored under slug `hy3` with no `tencent-` twin carrying a speed**; mpc's row reads it by key,
  so the sidebar is right, but anyone looking for `tencent-hy3` in `aam` sees the unscored listing.
