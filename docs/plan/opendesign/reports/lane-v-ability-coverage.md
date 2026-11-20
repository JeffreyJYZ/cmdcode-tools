# Lane V — Ability column coverage

## Result after all three rounds

`mpc --check`: **41 → 11 blank abilities**, **39/80 → 66/77 rows scored**.
Row count 80 → 77 because three naming artefacts collapse onto their real keys (two Muse Spark Contributor SKUs, one Tencent-prefixed Hy4 Flash). Two gained ability from a scored base; one was a dedupe of two unscored spellings. No score was fabricated.

## Which numbers came from where (rate limit)

- **Live, bounded fetches:** both CC docs pages, `/models`, `/models/<slug>` detail probes, and `/leaderboards/models`. The leaderboard scrape needs no key and is unaffected by the API limit.
- **Live earlier this session:** the AA free-API recon, 4 pages × 200, 758 rows / 758 slugs / 146 scored, index version 5. Taken **before** the daily quota was spent.
- **`lastGood` replay:** every later `--check`. It reports `Artificial Analysis (last good, 0h old — API: Artificial Analysis API 429: daily quota spent …)` and carries 159 AA keys. So the 35 → 59 score counts are lastGood-era, not fresh AA figures. CC fills and the leaderboard scrape still ran live in those runs (`filled 2 values from AA web scrape, 23 values from CommandCode`).

## Round 3 — leaderboard source

Added `AA_LEADERBOARD_URL` (`src/constants/sources.ts`), a new pure `parseAaLeaderboard(html)` (`src/data/sources/aa/leaderboard.ts`), and merged it into `loadAaWeb()` (`src/data/sources/aa/web.ts`) with `AbortSignal.timeout(20_000)` on both page fetches. The leaderboard leads; `/models` is the per-key fallback; best value per key wins. `parseAaWeb` itself is unchanged and still pure.

Record boundaries found: the RSC `initialModels` array holds **282 records**, each with exactly one `intelligenceIndex`. **115 numeric + 167 null**. The page's raw HTML has 493 `intelligenceIndex` string occurrences (escaped + unescaped copies); the "284" from the brief is an occurrence count, not 284 scores. **All 115 numeric scores are extracted** — the naive 115-pair count was already complete, not a truncated window. Records are keyed on `release.slug` first, then `name` / `shortName` / `release.name` through `aaKeyVariants`, which collapses effort variants sharing a release slug: **68 distinct intelligence keys, 113 speed keys**. Fixture-pinned in `test/data/aa-leaderboard.test.ts` (scored slug, effort variant, null index, speed-only row).

Effect on `--check`: the new scrape added **2 keys** to the catalog-keyed ability map and **1 speed value** (54 → 55), but **0 new scored rows** — both keys were already filled from another side. Residual stayed 11.

## The four re-checks against the leaderboard's 1,041 names

| key | leaderboard | closest name in payload | decision |
| --- | --- | --- | --- |
| hy4preview | absent | `Tencent Hy4` (iq 34.5552385392508) | **no alias.** Exact name `Tencent Hy4 Preview` is absent from all 1,041 names. CC lists `hy4` (launched 2026-11-04) and `hy4-preview` (2026-08-27) as distinct builds with different blurbs; AA's scored `tencent-hy4` has releaseDate 2026-11-03, matching the base, not the Preview. |
| longcat25 | absent | `LongCat 2.0` (iq null), `LongCat Flash Lite` (null), `LongCat` (null) | no 2.5 anywhere; no score to take |
| qwen37flash | absent | `Qwen3.7 Plus`, `Qwen3.7 Max` (both iq null) | no Flash row; no score to take |
| qwen38maxprime | absent | `Qwen3.8 Max`, `Qwen3.8 Max (0902)` (null), `Qwen3.8-Flash-Next` (28.575) | Prime and Omni Flash absent; nearest scored row is a different model |

## Residual 11 — evidence

Checked against: live leaderboard (282 rows / 115 scores / 1,041 names), live `/models` (27 scored), the 758-row free-API recon, live per-model detail probes, and both CC pages' `models` arrays (212 rows / 77 scored).

| key | evidence |
| --- | --- |
| hy4preview | no exact name in any AA payload; no detail route; CC `hy4-preview` `$undefined`; distinct launch date from scored Hy4 |
| icemancontributor | no slug or name in any AA payload; no detail route; no CC row |
| longcat25 | only LongCat 2.0 / Flash Lite / LongCat, all null; no detail route; CC `longcat-2-5` `$undefined` |
| hy4flash | no AA row or route; CC `hy4-flash` `$undefined` |
| qwen38omniflash | no AA row or route (only Qwen3.5 Omni Flash, own null); CC `qwen3-8-omni-flash` `$undefined` |
| qwen38maxprime | no AA row or route; CC `qwen3-8-max-prime` `$undefined` |
| ornith15122b | no AA row or route; CC `ornith-1-5-122b` `$undefined` |
| jev | `Jev 1.14` listed in leaderboard names but unscored; no detail route; CC `jev` `$undefined` |
| flint | no AA row or route; CC `flint-v1-0-free` `$undefined` |
| glyphcluster | no AA row or route; CC `glyph-cluster-free` `$undefined` |
| qwen37flash | only Qwen3.7 Plus / Max, both null; no detail route; CC `qwen3-7-flash` `$undefined` |

Three other variants (`deepseekv4flashfast`, `kimik27codehighspeed`, `glm52fast`) are not blank: existing `lookupAbility` suffix inheritance legitimately gives them their scored base's ability.

## Round 4 — `indexScore` is a different metric; not substituted

Live homepage fetch (`AbortSignal` bounded): 69 numeric `indexScore`, 56 numeric `intelligenceIndex`. `indexScore` exists only in two arrays — `contestants` (29 rows, `kind: llm | decisionModel`) and `benchmarkRows` (40 rows) — and **no object in either array has an `intelligenceIndex` field**. Comparing by name across arrays:

| model | `indexScore` | `intelligenceIndex` | ratio |
| --- | --- | --- | --- |
| Claude Haiku 5.5 (Max) | 76.49 | 36.48 | 2.10 |
| GPT-6 Luna (Max) | 75.67 | 27.86 | 2.72 |

`benchmarkRows` reuses the same field name for a 0–1 fraction (0.15–0.58), e.g. Beam 1.0 `indexScore` 0.15 vs `intelligenceIndex` 17.73. So `indexScore` is not one scale, let alone the Intelligence Index. **Do not substitute.** `Jev 1.14` is `kind: decisionModel` with `indexScore` 66.23416034232282 and `costPerTaskUsd` 0.000156 — a decision-benchmark score, not an intelligence score. It stays blank. A fixture test now pins that the AA parsers ignore `indexScore`.

Other numeric `score`/`index` keys on the homepage: `automationBenchPartialScore` (28), `vialsScore` (15), `intelligenceIndexTimePerTask` (26), plus `intelligenceIndexCostPerTask`. The first two are 0–1 component benchmarks inside `scores`; the latter two are derived cost/time figures. No third composite score exists.

No residual key gained a value from `indexScore`: `flint`, `glyphcluster`, `icemancontributor`, `hy4preview`, `hy4flash`, `longcat25`, `ornith15122b`, `qwen37flash`, `qwen38omniflash`, `qwen38maxprime` have no `indexScore` record at all. Residual remains **11**.

### `DeepSeek V4.1 Flash Eco` blank — not a regression

Checked with `--od-plan go`: row `deepseekv41flasheco`, `odAbility: null`. No source has ever carried that key: 758 AA list slugs, 282 leaderboard rows, 159 `lastGood` keys, both CC pages' RSC `models` arrays and their HTML tables all lack it; `SPEED_SUFFIXES` (`ultraspeed/highspeed/ultrafast/fastx/fast`) has no `eco`, and there is no config `inheritSuffixes` override. HEAD's parsers had exactly the same sources, so the blank is upstream absence, not a null overwrite or early return from this work. The semantically correct fix (inherit the base ability, as OD inherits its price) is applied in Round 5 after the lane's scope was widened to `src/constants/scoring.ts` and `src/cli/engine/ability.ts`.

## Round 5 — final verdicts and the Eco fix

### Presence in AA's ~757-model set (slug first, then name)

Matched each residual key against the 758-row API payload's slugs and names, the leaderboard's 282 rows, its 1,041 names, the homepage's names and `/models`' names.

| key | in AA's list? | closest name | does AA render a score? | verdict |
| --- | --- | --- | --- | --- |
| hy4preview | no | `Tencent Hy4` | no (only base scored) | absent from AA |
| hy4flash | no | `Tencent Hy4` | no | absent from AA |
| longcat25 | name `LongCat` only | `LongCat`, `LongCat 2.0` | `LongCat 2.0` `intelligenceIndex: null` | absent from AA (2.5 not listed) |
| ornith15122b | no | none | no | absent from AA |
| qwen37flash | no | `Qwen3.7 Plus`, `Qwen3.7 Max` | both null | absent from AA (Flash not listed) |
| qwen38omniflash | no | `Qwen` / `Qwen3.5 Omni Flash` | Omni 3.5 own `intelligenceIndex: null` | absent from AA (3.8 Omni not listed) |
| qwen38maxprime | no | `Qwen3.8 Max`, `Qwen3.8 Max (0902)` | both null; only scored 3.8 row is Flash-Next | absent from AA (Prime not listed) |
| jev | name `Jev 1.14` on homepage + leaderboard names | `Jev 1.14` | only decision-model `indexScore` 66.234; no intelligence index | listed but unscored |
| flint | no | none | no | absent from AA |
| glyphcluster | no | none | no | absent from AA |
| icemancontributor | no | none | no | absent from AA |

No residual is "scored, we are missing it". Ten are absent from AA's set, one (`jev`) is listed without an Intelligence Index. Both categories are out of scope for a fix.

### `hy4preview` is a different build from AA's scored `Tencent Hy4`

AA `/models` record for `tencent-hy4`: `releaseDate: 2026-11-03`, `intelligenceIndex: 34.5552385392508`. CommandCode docs: `hy4` launched **2026-11-04**, `hy4-preview` launched **2026-08-27** (blurbs also differ: "long-horizon agentic coding with image understanding" vs "agentic coding & sustained multi-step tool use"). OpenCode's `/zen/go/v1/models` has both `hy4` and `hy4-preview` as separate ids sharing one catalog `created` timestamp — no per-model launch date. So AA's scored row is the base build, not the Preview; **no alias**, blank stays.

### Eco fix applied

Scope widened for this one item. Added `ABILITY_SUFFIXES = [...SPEED_SUFFIXES, "eco"]` in `src/constants/scoring.ts` and switched `lookupAbility`'s default to it. `lookupTps` deliberately keeps `SPEED_SUFFIXES`: Eco is a 0.27×-priced SKU of the same model (OpenDesign prices it via `priceKey: deepseekv41flash`), not a faster tier, so it must inherit ability but **not** a ×2 throughput. An `ALIASES` entry was rejected because `normalizeKey` is global — it would collapse the OD Eco row into the base row and lose its separate allowance/cap. Test added in `test/unit/core/cost.test.ts`. Result with `--od-plan go`: `deepseekv41flasheco` `odAbility: 32.6` (base score), `OpenDesign unpriced: 0`, **67/78 rows scored**, same 11 missing.

## Round 6 — where the #intelligence chart dots come from

Read all 59 referenced `/_next/static/chunks/*.js` bundles (62 saved, all fetched with a 12s abort). Two endpoints appear: `/api/models/endpoint-models` and `/api/models/output-speed-over-time` — neither feeds the intelligence chart. The chart component in chunk `32456` takes `initialModels` as a server fallback but sets `allItems: data?.models ?? initialModels`, where `data` comes from a **manifest prop**:

```
"manifest":{"path":"/data/324ed05c14a0dc8b.txt","key":"<64 hex chars>"}
```

The homepage RSC embeds five such manifests. The intelligence one is a 77 KB **encrypted binary** at that path. Chunk `87763` shows the client routine: hex-decode the key to 32 bytes, IV = first 12 bytes of SHA-256(key), AES-GCM decrypt (tagLength 128), gzip-decompress, `JSON.parse`. Decrypting it locally (bounded 15s fetch) yields `{models: 757, capabilityModels: 159, decisionIndexContestants, changelog, …}`.

**The 757 chart records are the ~757-model set.** Every record carries `intelligenceIndex` (146 numeric, rest null) and a separate `score` field (692 numeric, different scale — Claude Fable 5.2 has `intelligenceIndex` 64.56 but `score` 357.95; GLM-4.5V has index null but score 166.44). The chart's own rendering code plots `x: e.intelligenceIndex`, so `score` is not the index. The 146 scored rows match the free API's 146 — **no richer keyless score source exists**; the chart is not fed by an endpoint with more scores. No new parser was added, since wiring this in would add zero keys beyond the sources already merged.

Per the 11 blanks against the chart's 757 records (slug then name): **all 11 are absent from those 757** — closest names: `Tencent Hy4` (hy4preview/hy4flash), `LongCat 2.0` (longcat25), `Qwen3.7 Plus/Max` (qwen37flash), `Qwen3.8 Max (0902)` (qwen38maxprime/qwen38omniflash); `ornith15122b`, `icemancontributor`, `jev`, `flint`, `glyphcluster` have no close chart name. `LongCat 2.0` is listed with `intelligenceIndex: null`; `Jev 1.14` is not among the 757 at all. Verdict for every blank: **absent from AA's covered set** — out of scope, correctly blank.

## Gate

153 tests pass / 0 fail (27 files); `bun check` no type errors (110 files); my 12 files clean under `bun fmt --check` and `bunx biome lint`. Whole-repo fmt flags pre-existing `oc-cmd-compare/src/index.ts` (another session); biome reports only its pre-existing schema-version info. No commits, tags, pushes or version files.
