# AGENTS.md

Agent notes. README user-facing; architecture/contracts/traps here.

## What this is

`bun`/TypeScript CLI: measures token shape of real opencode traffic, reprices on any model.

Siblings:

| tool | takes from it |
| --- | --- |
| `mpc` (`~/dev/cmdcode-tools/oc-cmd-compare`) | `mpc --json --shape off` — pricing, allowances, window ratios (`--shape off` mandatory: see Contracts) |
| `cmduse` (Rust CLI) | `cmduse -1 --json` — account request count for the period, context line only |

`MPC_BIN` / `CMDUSE_BIN` point either call at a dev build.

## Layout

```
src/index.ts             entry
src/types.ts             Req (one model call), Ask, Profile, Shape, Stats
src/constants/keywords.ts  DEFAULT_KEYWORDS + FILLER (noise filtering)
src/constants/providers.ts CC_PREFIXES (CommandCode provider ids)
src/constants/asks.ts    BOUNDARY (row kind -> AskKind)
src/constants/layout.ts  LABEL + table column widths
src/constants/ansi.ts    ESC + ANSI
src/cli/options.ts       Options, defaultOptions
src/cli/flags.ts         flag readers: str, number, oneOf, sinceOf, keywordList, customOf
src/cli/parse.ts         cac declarations -> Options
src/cli/run.ts           orchestration
src/measure/rows.ts      store rows -> RawMessage (v2 + legacy layouts)
src/measure/store.ts     readStore: layout detection, session metadata merge
src/measure/asks.ts      messages -> asks, with each req's position in its session
src/measure/filter.ts    keep/drop decisions, normalisation, the keyword rule
src/measure/stats.ts     FIELDS + reqProfile + mean + percentiles (one place a field is read)
src/measure/profile.ts   buildShape: per-req, per-conversation and per-side vectors, buckets
src/measure/sides.ts     sideOf + sideProfiles: provider id -> oc / cc
src/market/rates.ts      RateEntry types and labels
src/market/entries.ts    mpc payload -> entries, window ratios, custom entries
src/market/sources.ts    the subprocess calls (mpc --json, cmduse -1 --json)
src/market/project.ts    $/req, req/mo, req/5h, req/wk
src/view/format.ts       counts, money, dates, colour
src/view/sections.ts     the measurement blocks
src/view/table.ts        the model table
src/view/render.ts       renderText
src/view/json.ts         renderJson
test/                    cli, measure, market, view
```

## Commands

```sh
bun install
bun test                       # unit tests
bun run typecheck              # tsc --noEmit
bunx biome check --write .     # format + lint (always before commit)
bun run src/index.ts --help
bun link                       # exposes the `reqshape` binary
```

**`bun link` must be re-run after the repo moves, and can be silently pruned.** Writes `~/.bun/bin/reqshape` → `~/.bun/install/global/node_modules/reqshape/src/index.ts` (an **absolute** path), so a moved checkout leaves it dangling — and a later `bun link` in a sibling repo prunes the entry (only `mpc`, which shells it, notices). Fix: `bun link` here; verify `test -e ~/.bun/install/global/node_modules/reqshape/src/index.ts` (`ls -l` proves nothing — the symlink survives dangling).

## The lexicon

- **req** — one model call (`assistant` row); sidebar and billing unit. Agentic ask = many reqs.
- **ask** — prompt that opened a run of reqs + those reqs.
- **position** — req's 1-based index in its session; cache read grows along (only useful bucket split).
- **per-req vs per-conversation** — two weightings, disagree ~4x.

## Contracts

- `mpc --json`: `plans[<id>].{credits,fiveHour,weekly}` and `rows[].{oc,cc}.{pricing{input,output,cacheRead,cacheWrite},allowance,requestsPerMonth,requestsPerFiveHour,requestsPerWeek,free}`. Anything else optional. `pricing: null` = *unpriced*, not free; `entriesOf` skips it, never prices at zero.
- Window ratios **derived, never restated**: `ratiosOf` prefers plan block (`fiveHour / credits`), else row windowed count ÷ monthly count.
- `cmduse -1 --json`: `summary.requests`, `plan`, `periodEnd`. Missing/ unauthenticated = no account line, never error.
- **`--format json` feeds `mpc`'s `--shape auto`/`--shape measured`**: top-level `profile` (same vector as `shape.perReq`) becomes one `Workload`, priced on **both** plans. Keep `profile` a bare token vector (mpc rounds means). `auto` also reads `shape.reqs`, trusting profile only at mpc's `SHAPE_MIN_REQS` — **`shape.reqs` must stay the true kept-req count**, else mpc silently flips measured↔fixed. `sides.{oc,cc}` is ours only; mpc ignores it. oc/cc split here (`command-code*`/`commandcode` → cc, `opencode*` → oc, else excluded): a new CommandCode id goes in `CC_PREFIXES` in `src/constants/providers.ts`.
- **`loadMpc` must call `mpc --json --shape off`**: mpc default `--shape auto` shells to `reqshape`, which runs `mpc --json` — recursion (mpc -> reqshape -> mpc -> ...). The cycle break, not sugar.
- `sides` additive: old `perReq`/`perSession` consumers unaffected; missing `sides` = fallback, not error.

## Rules

- Biome only, tabs width 4, TypeScript, Bun over npm, `cac` only runtime dep. Imports: `#~/` outside file's own dir, `./` siblings. The alias is the `"#~/*": "./src/*"` entry in `package.json` `imports`, **not** a tsconfig `paths` — a tsconfig alias does not survive `npm install` (published tarball ships no `tsconfig.json`, so an installed copy dies `Cannot find module '~/…'`; fixed 0.1.2). `imports` ships with package.json and resolves package-scoped, immune to the consumer's cwd or its own `~/*` tsconfig; `#/` alone is an invalid key so the prefix is `#~`. Bun honours it runtime + tests, tsc resolves it natively, so no build step.
- Tests must not touch network: unit tests build fixtures; live `mpc`/`cmduse` by hand, never `bun test`.
- Size limits: ~100 lines/file, hard cap 150; ≤6 entries per dir. Check `wc -l $(rg --files -g '*.ts' src test)` + per-dir count. `test/` split `cli/`, `measure/`, `market/`, `view/`.
- No re-export-only barrels; import the owning module.

## Traps (each of these was a real bug)

- **cac prints `--help`/`--version` but does not exit** — sets `run = false`, so report prints after help. `answeredByCac` sees `help`/`version` in the parsed bag; `run()` returns before work. mpc same flaw: match the fix here.
- **`mri` coerces values**: numeric string → number, `""` → `0`, valueless flag → `true`. Read all string options via `str()` in `flags.ts`; `number()` refuses boolean.
- **cac leaves a digit-dash flag hyphenated**: `--cap-5h` arrives key `"cap-5h"`, not `cap5h` — unreadable under camelCase, so it did nothing. Caps `--five-hour`/`--weekly`; `test/cli/parse.test.ts` guards this.
- **cac negates a declared flag itself**: declaring `--no-color` *and* reading `color === false` let declaration win (`color` default `true`, validation failed). Declare `--color` only; `--no-color` arrives `false`.
- **Session metadata lives in two tables**: v2 `session_v2`, legacy `session` older. Reading only `session` lost the current session, so `--project` matched nothing. Read both, v2 winning.
- **Completed turn carries `cost` and `tokens`; in-flight one does not** — v1 and v2 look empty mid-stream. Turns without `tokens` skipped, never zero-token.
- **`cacheRead: null` vs `cacheRead: 0`**: null = no published cache rate (bill context at input rates, flag row); zero = cached reads free. Conflating fabricates or hides a cost.
- **Reasoning tokens bill as output** on every provider — join the output term in `project()`. `tokens.output`/`tokens.reasoning` are *separate* counters, not a subset; never fold one into the other, never bill twice. Both add it once: `project()` here, mpc's `costPerRequest`.
- **`requestsPerMonth` is `Infinity` for a free model** — serialises to `null`, meaning *unbounded*. Keep out of comparisons: `sortProjections` compares explicitly because `Infinity - Infinity` is `NaN`.
- **Weighted average is two different numbers here**: do not "fix" per-req mean by switching to per-session; both printed, `--weight` picks (they disagree 4x, user should see why).

- **Only a `user` row opens an ask; interjections continue it**: `synthetic`/`system`/`compaction`/`shell` were boundaries too, so a system-reminder between prompt and answer made the answer's reqs a `system` ask, which `filterAsks` discarded whole. They now attach to the ask they interrupted. `orphan` catches reqs before any user prompt.
- **A legacy store's `providerID` is real**: `readLegacy` hardcoded `provider: ""`, so a `message`-only store produced no `sides` and the PER SIDE section vanished — `message.data` carries `providerID`.
- **`customOf` watches every custom-model flag**: `--five-hour`/`--weekly`/ `--label` alone were ignored (`custom: null`, no error) because only rate/budget flags set `touched`; a lone one now demands rates + `--budget`.
- **The MODELS line's "…N more" needs the true total**: `modelsOf` caps display at 8; `Shape.modelTotal` carries the pre-cap count, so the suffix is not `capped - 6`.

## Not in scope

- Registering providers or inventing plans — rates come from `mpc`.
- Caching `mpc --json` — run it when deciding, not continuously.
