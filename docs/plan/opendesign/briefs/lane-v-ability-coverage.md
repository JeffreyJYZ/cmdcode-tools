# Lane V — fill the Ability column from Artificial Analysis' full model set

## The defect, measured

`mpc` has 80 rows. The Ability column is blank on 41 of them:

```
$ cd oc-cmd-compare && bun run src/index.ts --check
ability source:          Artificial Analysis (159 models, 450 speed) (35 scores, 54 speed, 39/80 rows scored)
ability missing (41):    glm52, musespark12contributor, musespark13contributor, hy3, hy4preview,
                         kimik27code, longcat20, qwen37plus, icemancontributor, longcat25, hy4flash,
                         deepseekv4flash, qwen37max, qwen36plus, gpt56sol, tencenthy4flash,
                         qwen38omniflash, qwen38maxprime, qwen38max0902, ornith15122b  +21 more
```

`--json` agrees: 58 filled, 49 blank side-cells.

The user's goal, verbatim: *"fix the ability column until all of the models mpc lists in the 757 models covered on https://artificialanalysis.ai/#intelligence is not blanked ability"*.

So: AA scores ~757 models on its Intelligence Index; `mpc` only reaches ~35 of them.

## Why coverage is short today

`oc-cmd-compare/src/data/sources/aa/web.ts` scrapes `https://artificialanalysis.ai/models` and decodes the Next.js RSC flight payload (`self.__next_f.push([1,"…"])`), reading only the `"initialModels"` array. That array is the page's **embedded top-N chart list**, not the full set. Measured just now:

```
GET https://artificialanalysis.ai/models        → 1,271,824 bytes
  intelligenceIndex keys in the payload         → 29
  distinct "name" values                         → 840
GET https://artificialanalysis.ai/             → 1,206,212 bytes
  intelligenceIndex keys                         → 57
GET https://artificialanalysis.ai/api/v2/language/models/free  → 401 (no AA_API_KEY on this machine)
GET https://artificialanalysis.ai/api/v2/data/llms/models      → 410 Gone (retired)
```

So the keyless scrape sees a fraction, and the API path needs a paid key the user does not have. **The data is on the site; the scrape is reading the wrong slice of it.**

Other measured facts worth starting from:
- The `/models` payload contains **840 distinct names** and **1,902 `slug` occurrences** — the model list is there and much larger than what `initialModels` yields. Something else in the payload (or another route/RSC segment) carries the per-model records.
- The page also links per-model detail routes: `models/claude-fable-5-2`, `models/deepseek-v4-1-flash-1017`, `models/glm-5-3`, … (only 14 found in the HTML, so they are not the full set either).
- 59 `/_next/static/chunks/*.js` bundles are referenced; the client must fetch its leaderboard data from *somewhere* — a route handler, a static JSON, or server actions. Finding that is the crux of this lane.

## What to find (in this order, cheapest first)

1. **Another RSC payload segment with the full list.** `decodeFlight` currently joins `self.__next_f.push` chunks and bracket-matches one key. Dump the decoded flight text and look for arrays carrying many more records than `initialModels` — other key names, a second `initialModels` occurrence, or a per-category payload (the homepage is organised by category: intelligence, speed, price, …). A single page may carry everything under a different key.
2. **A route handler or static JSON.** Fetch a few of the 59 chunk files and grep for URL literals (`/api/`, `.json`, `leaderboard`, `models?`). One of them will name the endpoint the table actually loads from. Then call that endpoint keyless and see whether it answers.
3. **A per-category or paginated route.** The homepage anchors `#intelligence`; the site may expose `?category=intelligence`, `?page=N`, or a `/leaderboards/*` route. Test them and record status + how many intelligence scores each returns.
4. **Only if 1–3 all fail:** document that the keyless surface genuinely stops at N models and say so plainly. Do not fabricate coverage, and do not scrape one page per model for 757 models.

## What to change

Thread the fuller source through the existing machinery rather than inventing a parallel path:

- `parseAaWeb` is a **pure parser over input text** and must stay that way (fixture-pinned, no network in tests). Extend it to read whichever key/segment actually carries the full list.
- `loadAaWeb()` fetches; if the full data needs more than one request, keep it there and bound the number of requests (a hard cap with a comment saying why).
- Keys: AA slugs still normalize through `normalizeKey`; the existing alias machinery (`aaKeyVariants`, `ALIASES`, `SPEED_SUFFIXES`) already handles bake dates and effort suffixes. **Coverage gaps are mostly key mismatches, not missing scores** — so for each of the 41 missing keys, check whether AA has a score under a slightly different slug before concluding AA lacks it. `mpc --check` lists them; print AA's candidate key for each and state the rule that reconciles them.
- Never coerce a missing score to 0; unscored stays unscored (`valueIndex = null`).

## Target

`bun run src/index.ts --check` must report **0 missing** abilities, or a short residual list where each entry is proven absent from AA (show the search you ran). `--json` must show no blank `ability` cell for any model that AA scores.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Every network call gets a bound**: `timeout 60 curl …` or an explicit `AbortSignal.timeout` in code. A hanging fetch is a defect.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `oc-cmd-compare/src/data/sources/aa/**`, `oc-cmd-compare/src/data/bench/**`, `oc-cmd-compare/src/constants/data.ts` (aliases), `oc-cmd-compare/src/constants/sources.ts` (URLs only), and `oc-cmd-compare/test/**`. **Do not touch** `core/**`, `cmduse/**`, `opencode-plugin/**`, or any version file.
- Gate: `cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint`, plus the real `--check` run. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-v-ability-coverage.md` as you go: which endpoint/segment you found, its measured coverage, the before/after `--check` numbers, and any key that is genuinely absent from AA. Final chat reply under 15 lines.
