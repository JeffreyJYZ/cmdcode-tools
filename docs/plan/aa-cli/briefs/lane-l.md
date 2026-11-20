# Lane L — two regressions from moving `mpc` onto `@jeffreyjyz/aa-models`, plus the docs

Repo `/Users/jyz/dev/cmdcode-tools`. The adapter landed on `main`'s working tree (commit `f50ea9f`, which the
coordinator will move onto a branch — do not commit anything yourself). Two measured regressions and one doc
debt remain.

## 1. Throughput changed for a model that did not change

```
DeepSeek V4.1 Flash   tps 229.62 -> 160.63   (-30%)
GLM-5.3               tps  72.85 ->  73.09
Tencent Hy4           tps  97.57 ->  93.20
```

Ability is fine (32.6 → 32.5896 is the same number at more precision; the raw payload carries the float).
Throughput is not: 229.62 is the figure the sidebar and the panel have been showing, and a 30% drop will be
visible to the user as a content change with no cause.

Find out which upstream field produced each value. The AA API publishes
`performance.median_output_tokens_per_second`; the page payload carries
`timescaleData.medianOutputSpeed`. They measure different things and must not be treated as one series.

- In `aa-models/src/model.ts` / `normalize.ts`, make `outputSpeed` come from one **declared priority order**
  (the stricter, documented field first — justify which in a comment), and make the merge in
  `sources/index.ts` keep that priority rather than "max wins across mixed fields".
- Prove it: print the raw value each source carries for `deepseek-v4-1-flash` (manifest, leaderboard, models
  page, API if a key answers), then show `aa`'s `--json` giving the same `outputSpeed` mpc had before
  (229.62) and `mpc --json --shape off` agreeing.
- If the true API figure really has moved to 160.63, say so plainly with the raw payload quoted, and leave
  the number alone — do not restore a value on a hunch.

## 2. A failed API call lost six speeds that used to be replayed

The AA free tier is 429 today. Before the move, mpc kept `~/.cache/mpc/aa-last-good.json` and replayed it when
the keyed call failed, so those models kept their speed. Now six keys (`musespark12`, `musespark13`, `hy3`,
`gpt56luna`, `qwen38max`, `kimik3`) come back blank.

`aa-models/src/sources/lastGood.ts` exists for exactly this and is documented as a failure fallback, not a
cache. Check whether `loadCatalogue` actually reads it on an API failure; if it does not, wire it: API fails
→ rehydrate last-good → mark the run `stale` with the age in `notes` → values present. Never write an empty
result, never let last-good overwrite a live value, and keep `cacheTtlMs: 0` meaning "no TTL cache" (it must
not disable the failure fallback).

Prove it by pointing the loader at a 429 (a stubbed fetch is fine) with a prepared last-good file and showing
the six keys filled and the note naming the age.

## 3. Docs

`oc-cmd-compare/README.md` and `oc-cmd-compare/AGENTS.md` still describe `src/data/sources/aa/{web,api,parse}.ts`
and mpc's own `aa-last-good.json`. Update both to the adapter (`src/data/sources/aa.ts`, the package, the
package's cache/fallback) and drop references to the deleted modules. Keep `AGENTS.md`'s agent-facing style —
architecture and traps, not user-facing prose.

## Constraints and gate

- Own: `aa-models/src/model.ts`, `aa-models/src/sources/{normalize,index,lastGood}.ts`, their tests,
  `oc-cmd-compare/src/data/sources/aa.ts`, `oc-cmd-compare/src/data/bench/**`, `oc-cmd-compare/README.md`,
  `oc-cmd-compare/AGENTS.md`, and the two docs paths. Nothing in `cmduse/**` or `core/**`.
- **Do not commit, do not branch.** Leave the work in the tree.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`. One tree, no worktree. No version bump, tag or
  publish, no `AGENTS.md` at the repo root.
- Gate: `cd aa-models && bun test && bun check && bun fmt --check && bunx biome lint`; `cd oc-cmd-compare &&
  bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, wait.

Report to `docs/plan/aa-cli/reports/lane-l.md`: the field priority you picked and why, the raw values per
source for DeepSeek, the last-good proof, and the before/after of all three models.
