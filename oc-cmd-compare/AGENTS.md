# AGENTS.md

Agent-facing notes for `mpc`. README user-facing — keep it so; architecture, gotchas, contributor rules here.

## Sibling repos (same owner)

`mpc` downstream of `~/dev/cmdcode-tools/cmduse` — same author, local-only (never push/publish without explicit go):

| sibling | mpc's dependency on it |
| --- | --- |
| `cmduse` (Rust CLI, `cmduse/`) | shelled out for `plans --json` (plan price/windows), `-1 --json` (account totals, coverage), `model --json --since <ISO>` (windowed per-model local usage) |
| `@jeffreyjyz/opencode-command-code` (`opencode-plugin/`) | consumes `mpc --json` for session sidebar (allowance, rates, Intelligence, Tok/s per model) |
| `reqshape` (`~/dev/cmdcode-tools/reqshape`) | `--shape auto` (default) / `measured` runs `reqshape --format json`, reads its combined per-req `profile` as one workload for both plans (`REQSHAPE_BIN` overrides binary); reqshape in turn runs `mpc --json --shape off` |

Contracts mustn't drift silently: cmduse JSON shapes (`plans`, `-1`, `model`) and `mpc --json`'s `rows[].{key,name,cc:{allowance,pricing,ability,tps,deal},oc:{...}}`, read by plugin sidebar. Change either side → update other same effort. `CMDUSE_BIN` points every cmduse call at dev build (`cmdusedev`). Payload top-level `workload` became `workloads` (one entry per side) when per-side shapes landed; plugin reads `rows[]` only, so rename needed no companion change — check `useRows.ts` before assuming any other key unread.

## What this is

`bun`/TypeScript CLI comparing model pricing across **OpenCode Go** and **CommandCode** (GOAT / Pro / Max / Go). Both sell monthly sub granting usage credits, per-model allowances at API token rates; `mpc` normalises both onto one table per model: cost per request, requests per month and per rolling window, volume index.

## Layout

```
src/index.ts                 entry
src/types.ts                 shared types
src/keys.ts                  canonical model key + branding aliases
src/constants/               module-level data constants: sources.ts (URLs, CC_PLANS, TTL),
                             scoring.ts (PER_MILLION, SPEED_*), view.ts (frame, columns,
                             LEGEND, CSV_HEADER, HEADERS, COLUMN_HELP), cli.ts (DEFAULTS
                             pairs, flag sets, METRICS/FORMATS/TIERS/SETS), data.ts (BOUNDARY,
                             ALIASES, deal regexes)
src/cli/run.ts               run(): orchestration
src/cli/options.ts           Options, validators
src/cli/parse/               cac.ts (declarations), map.ts (bag -> Options), fields.ts, validate.ts
src/cli/flow/                collect.ts, sort.ts, check.ts, columns.ts
src/cli/engine/              cost.ts, rows.ts, score.ts, ability.ts, scale.ts, index.ts
src/data/sources/            opencode.ts + cc/ (plans, cmduse, catalog) + aa/ (web, api, parse)
src/data/bench/              index.ts (loadAbility), resolve.ts, cc.ts, store.ts, types.ts
src/data/scrape/             index.ts, tables.ts, tabs.ts, roleRows.ts; catalog/ (catalog, numeric, variant)
src/data/usage/              index.ts (loadUsage), parse.ts (UsageEntry), log.ts (JSONL + merge),
                             logs.ts (session scan), opencodeDb.ts (opencode store, both
                             layouts), opencodeV2.ts (session_message reader)
src/data/shape.ts            --shape: reqshape payload -> one workload for both sides (REQSHAPE_BIN)
src/view/render.ts           renderText / renderJson
src/view/schema.ts           view types + the column registry
src/view/columns/            oc.ts, cc.ts, meta.ts
src/view/layout/             segments.ts, fit.ts, table.ts
src/view/text/               index.ts (colour + re-exports), format.ts, styles.ts
src/view/footer.ts           tally + legend + footer
test/cli, test/data, test/unit/{core,view}
```

Data flow: `loadOcGoCatalog` + `loadCcCatalog` -> `buildRows` (scoring across both) -> filter/sort -> `renderText`/`renderJson`.

## Commands

```sh
bun install
bun test                       # unit tests
bun run typecheck              # tsc --noEmit
bunx biome check --write .     # format + lint (always before commit)
bun run src/index.ts --help
bun link                       # exposes the `mpc` binary
```

Pre-commit: `bunx biome check --write .`, `bun run typecheck`, `bun test` all clean.

**`bun link` global entry can be pruned — bin dangles, `mpc` dies `ENOENT`.** `bun link` (in this repo) creates `~/.bun/bin/mpc` → `~/.bun/install/global/node_modules/mpc/src/index.ts`; that global `node_modules` shared with every `bun install -g`, so a global install/uninstall can remove entry while bin symlink stays. Silent: `command -v mpc` reports nothing (dangling symlink not executable); consumer spawning `mpc` gets `ENOENT`, no local symptom — plugin's model block degrades to name-only. Restore with `bun link` here; check target with `test -e ~/.bun/install/global/node_modules/mpc/src/index.ts` (bin's `ls -l` still *shows* old path, proves nothing).

Same prune hits every `bun link` in group (`reqshape` too); global symlink stores **absolute** path, so moving repo breaks it before any prune. `--shape measured` warns reqshape missing → restore with `bun link` in `~/dev/cmdcode-tools/reqshape` (see that repo's AGENTS.md).

## Usage projection

- `--usage` merges sources. Primary **opencode's own store** (`data/usage/opencodeDb.ts`, read-only via `bun:sqlite`), two layouts. v2 (`data/usage/opencodeV2.ts`) appends `session_message`, stopped writing `message` at migration — legacy query reads nothing on upgraded install; *completed* assistant turn carries `model{id,providerID}`, `cost`, `tokens`; in-flight carries model only, skipped till finished. Legacy `message` layout (`message.data` flat: `modelID`, `providerID`, `cost`, `tokens{input,output,cache}`) fallback. Either way complete, backfilled for every provider opencode ran. External JSONL log (`--usage-log`, `MPC_USAGE_LOG`) fallback when DB missing; `cmduse model --json --since` (cmduse 0.6.x+) and `data/usage/logs.ts` cover CommandCode CLI sessions. `CMDUSE_BIN` overrides cmduse binary (dev builds).
- Account API has no per-model dimension (Studio's surface same endpoint) — why opencode's own store is per-model source.
- **delta (Zed's new app) not a usable per-model source.** Runs Command Code — model ids (`command-code-openai`, `command-code-zed/…`, `deepseek-v4-flash`) in `~/Library/Application Support/delta/user_<id>/data.sqlite` — but conversation lives in content-addressed **CRDT blob store** (`nodes`: `MapInner.CowHashMapNode` protobufs, tens of thousands of rows, beside WAL dwarfing db), not per-message table like opencode's `session_message`. No model/token/cost column to join. Split cmduse exposes: **account-wide** views (`-1 --json`, `daily`, `hourly`) from account API cumulative summary (`fetch_pool` → `daily_from_cumulative`, `ByDay` only) — *do* count every harness, delta included — but **no model dimension**; **per-model** views (`cmduse model`, `cmduse session`, `--local`) walk `~/.commandcode/projects`, CommandCode CLI's own sessions only. Delta lands in totals, nobody's per-model mix — exactly gap usage report's `cover` line shows (`local usage N of M account requests`). Add as source = decode that CRDT, not another `--usage-db`-style reader.
- **No per-model account endpoint** (`cmduse mcp` exposes account totals only); report prints coverage line against `cmduse -1` totals, warns when coverage < 90%. Coverage below 100% = traffic from a harness storing nothing locally (or another machine); `--usage-file` covers that.
- cmduse reports **per-model totals** not per-request — `engine/project.ts` divides by `requests` only for per-request figures.
- **`--usage` prices same rule as fixed workload** (`project.ts`'s `totalCost`): reasoning joins output term, unpublished cache-write rate bills at input rate. Once omitted reasoning and billed cache-write at `0`, so `your $` / `$/req` / `$/mo` read low on reasoning-heavy traffic. `UsageEntry` now carries `reasoning` counter, populated from opencode's store (`tokens.reasoning`); CommandCode session-log block has no such counter, stays 0.
- `--usage-months` scales period to month; header says which. Unmatched models listed in report, never silently dropped. `--format json` dumps whole projection.
- **`head-to-head` line compares plans only on models both price** (`headToHead` in `view/layout/usage.ts`). Summing every row lets a model only one provider sells pad that side's total while adding nothing to other — a real mix of one tied model plus two CC-only read as "OpenCode cheaper by 45%", 100% the CC-only rows. One-sided rows excluded, count printed; no overlap → verdict `none`, never a win. Plain per-side `totals` line stays: each side's own projected cost still true.

## Config and plugins

- **Scope boundary:** extensibility config only (flags, config file, config-layering plugins). New providers/plans explicitly out of scope — tool compares OpenCode Go against CommandCode's real plans, nothing hypothetical.
- Precedence: defaults < plugins (listed order) < user config < CLI. `resolveBag(argv)` (`cli/config.ts`) merges; `parseFlags` (raw CLI) and `parseArgs` (CLI-only Options) stay sync so tests never touch filesystem.
- `cli/plugins.ts`: plugin `.json`, or `.js`/`.ts`/package default-exporting a config bag or factory `(ctx) => bag`. Relative paths resolve against config file's directory.
- Every flag persistable because config keys are raw camelCase bag; `assertKnown` validates every layer, so typos in plugin or config fail loud.
- All scoring knobs in `ScoreConfig` (`cli/engine/score.ts`): `valWeights`, `scale`, `inheritSuffixes`, `window`. Colour thresholds via `setThresholds`, colour mode via `setColorMode`.

## CLI parsing

- Flags declared once in `src/cli/parse/cac.ts`, parsed with `cac`; owns `--help`, `--version`. `src/cli/parse/map.ts` reduces parsed bag to `Options`; `src/cli/parse/validate.ts` whitelists keys (unknown flags throw), checks ranges.
- **cac does not exit on `--help`/`--version` — prints and returns.** `run: false` → parse returns `help`/`h` and `version`/`v` as *four* separate keys, so `validate.ts`'s `INTERNAL` set lists all four, and `run()` returns `0` on either pair before any work — without early return whole table printed after help text, and `-h`/`-v` died on `unknown flag "--h"` (exit 1, also broke piping help).
- **A value-taking flag used bare yields boolean `true`, not undefined.** `assertValues` rejects a bare value flag by name (`--usage-window expects a value`), stopping `String(true)` becoming literal `"true"` (once tried to read file named `true`). Two exempt: `config` (`--no-config` makes `true` its default, so bare `--config` indistinguishable from "use default path") and `shape` (**bare `--shape` means `measured`**, mapped in `map.ts`). Every `--no-<x>` flag defaults its positive to `true` — why `fit`/`fallback`/`ability` read `true` with no flag.
- **cac/mri coerces blank value to `0`**, not `""` (`--width ""` → `0`, silently disabled trimming; `--out ""` → `0`). `assertValues` covers bare-flag case; `int`/`share` reject `""`/boolean for values from config/plugin layers; `width` required `≥ 1` because real `0` meaningless.
- `--no-color` / `--no-fallback` / `--no-ability` are cac negations: code reads `color === false`, `fallback === false`, `ability === false`.
- **Plugins are lowest layer, `--plugin` included.** `resolveBag` merges config file's plugins *and* CLI's plugins before user config, so config overrides both; loading `--plugin` last let CLI plugin beat config file, contradicting documented order.
- **`--print-config` validates before it prints** (`assertKnown` + `assertValues`), so typo or unknown key fails there, not next real run.
- `resolveBag(argv)` real entry point (async, applies config + plugins); `parseArgs(argv)` CLI-only, sync, for tests. `--columns help` still prints `COLUMN_HELP` from `src/constants/view.ts`. `-h`/`-v` exit inside cac, so tests must not pass them.

## Rules

- **Biome** only formatter/linter (`biome check --write`). No Prettier/ESLint. Biome supports file type → use it.
- `cac` only runtime dependency; keep it that way unless strong reason.
- `biome.json` `$schema` must match installed Biome version, else biome prints migrate notice. Bump when upgrading.
- **Bun** over npm. **Tabs, width 4.** TypeScript, not JS.
- **Imports: `#~/` for anything outside file's own directory, `./` for siblings.** Alias is the single `"#~/*": "./src/*"` entry in `package.json` `imports` (Node/Bun-native subpath), **not** a tsconfig `paths` — a tsconfig alias does not survive `npm install`: the published tarball ships no `tsconfig.json`, so an installed copy cannot resolve `~` (0.1.2 fix: bare `~/*` imports died `Cannot find module '~/…'` for every global install). `imports` lives in package.json, which always ships, and resolves package-scoped regardless of the consumer's cwd or its own `~/*` tsconfig. `#/` alone is an invalid `imports` key (Bun rejects it) — that is why the prefix is `#~`. Bun honours it at runtime, in tests and under `bun link`; tsc resolves it natively (`moduleResolution: bundler`), so no build step. Targets outside `src/` (test fixtures, `package.json`) stay relative.
- Tests must not hit network — extend inline fixtures in `test/data/catalog.test.ts` and `test/unit/scrape.test.ts`.
- Contracts to preserve:
  - `buildMetrics` invariant: `payPerRequest * requestsPerMonth === plan.price`.
  - Free models: `costPerRequest === 0` ⇒ `requestsPerMonth = Infinity`, `index = 100`. JSON has no `Infinity`, so `renderJson` (plain `JSON.stringify` of `rows`) emits `requestsPerMonth: null` — and `requestsPerFiveHour`/`requestsPerWeek` with it. **`null` means unbounded, not unknown.** Consumer treating it as missing data (or comparing numerically) wrong; `sortProjections` in reqshape guards it explicitly for this reason.
  - One shared index scale across both providers (`buildRows` scores concatenated list).
- Keep README user-facing; agent/design notes here.
- **Size limits (pragmatic, not a game):**
  1. Aim ~100 lines per file, hard cap **150**. Split when a file has two reasons to change, never just to hit a number.
  2. A directory holds at most **6 entries** (files + subdirectories). Group by responsibility. Check: `wc -l $(rg --files -g '*.ts' src test)` and a per-dir entry count.
- **No re-export-only barrels.** Import concrete modules. A module holding real code and also re-exporting a few names for convenience fine.

## Scraping lessons (the messy part)

Everything below was a real bug. Keep them in mind when touching `src/html.ts`.

- **Text nodes concatenate.** A cell like `<del>$15</del> <strong>$60</strong><small>4x</small>` flattens to `$604x`. `parseTables`/`parseRoleRows` insert `BOUNDARY` (`\u0001`, from `constants/data.ts`) between text nodes; `parseMoney` splits on it, takes **last** segment carrying a price. Don't join text nodes without marker.
- **Biome forbids control chars in regex literals** (`noControlCharactersInRegex`). Never write `/\u0001/`. Use `str.split(BOUNDARY)` — not a regex.
- **Header cells carry sort arrows**: `Input ↕`. `headerIndex` strips non-alphanumerics before matching; input/output match on prefix (`/^input/i`) because CommandCode's grid writes `Input/M`.
- **Deal strikethrough**: `~~$30~~$67` — last `$` in cell is current value.
- **Deal badges are later text nodes of name cell**: cell reads `Grok 4.7` · `-40%` · `Ends September 27, 2026`, joined by `BOUNDARY`; `nameCell` keeps only first node, so `dealIn` reads rest for DEAL column. Paid models priced from *credits* tables, no badges, so `fillDeals` lends them badge from rate-only pass; without it every paid deal vanishes while free ones survive. Expiry needs no logic: docs drop badge and revert price themselves (Grok 4.7 went back to full rate when -40% lapsed).
- **Model name cells append badges** (`Grok 4.7` + `-40%` + `Ends September 27, 2026`). Take first `BOUNDARY` segment as name or key gets polluted.
- **OpenCode Go rows duplicate models**: off-peak vs peak, `≤ 256K` vs `> 256K` tiers. `variantScore` picks base tier and off-peak by default; `--peak` flips preference. Dedup by canonical key.
- **CommandCode layouts differ per plan, shape declared, never inferred.** GOAT/Pro/Max publish `<table>`s with explicit per-model credits (Pro three tables; Max two credit columns). **Go ($1) plan publishes no credits column but is a `<table>` now** (used to be `role="row"` div grid): every model gets plan's whole credit pool via `defaultAllowance`. `loadCcCatalog` selects parser from `CC_PLANS[id].grid` — **do not branch on `!creditHeader`**, what broke Go: "no credit header" no longer means "grid", so Go was sent to `parseRoleRows`, matched nothing, load threw.
- **"Older models also available" are prose-only** on GOAT/Pro. Filled with documented standard allowance (`standardAllowance`: $20 GOAT, $30 Pro) from wide catalog grid, not credits table. Prefer explicit allowance rows over fallbacks when both exist (`loadCcCatalog` merges fallbacks only for keys not already present).
- **Free models** parse as `$0.00` / `Free`; allowance irrelevant once cost 0. OpenCode's free Go rows put `Unlimited` in the monthly-limit cell (with a `limited time` note), not a $, so `parseMoney` returns null and the row was dropped whole. `UNLIMITED` (`constants/data.ts`) records allowance **0** (keeps it out of `ocGoPlan`'s summed credits, marks it free for `--check`), and the `-` cache-write cell becomes 0 for these rows (a free model's rate is 0, not "unpublished"). Their `… Free` name suffix is docs-only and **systematic** (docs append it to every free model), so `normalizeKey` strips one trailing `Free` marker generically — never a per-model `ALIASES` entry — or the free row sits beside its base-keyed counterpart as a duplicate instead of merging. LongCat 2.5 Preview has no CommandCode counterpart (it sells only LongCat 2.0), so it stays a one-sided OC row; Step 5 Preview merges.
- Numeric formatting: `fmtUsd` fixed-point, trims zeros — scientific notation (`$3.67e-5`) rejected by user as unreadable.

## Model matching

`normalizeKey` lowercases, drops vendor prefix and parentheticals, strips punctuation, then applies `ALIASES` table in `constants/data.ts`. Add alias whenever model appears on one side only from branding (check `mpc --check`, lists `only in OpenCode` / `only in CommandCode`). OpenCode's free `… Free` rows drop the trailing marker in `normalizeKey` itself (the suffix is systematic, docs-only); the CommandCode free-handling is a separate mechanism (rate-only pass + `fillDeals`), not a key alias. Speed variants (GLM-5.2 Fast, Kimi K2.7 Code HighSpeed, MiMo V2.6 Pro UltraSpeed) intentionally distinct keys.

## Metrics semantics

- `payPerRequest = planPrice * costPerRequest / allowance` — plan-relative. Cheaper subscription can post lower per-request cost while buying fewer requests, so `$/1K` effective rate, `req/mo` volume signal.
- Rolling windows scale monthly figure by plan's own ratio: OpenCode Go fixed 20%/50%; CommandCode derives from plan's 5h/weekly dollar caps (20%/50% on GOAT and Pro, 30%/60% on Max and Go).
- `COST` = inverted **volume** score: `100 - 100*volume`, min-max normalised `log10(requestsPerMonth)` across every model-provider entry — "how many requests the plan buys". Cache and output prices own columns, **not** folded in (was `--idx-weights` blend; flag and blended index dropped). Lower is better, so colour thresholds and default sort opposite of VAL.
- Skewed terms use `logMinmax` (log10 then min-max): volume, tps, cache price, output price. Without it a single outlier (e.g. 1000 tps model, or $0.002 cache) squashes everyone else toward one end. Ability stays linear. Non-positive values clamp to `1e-6`.

## Workload and measured shape

- `Workload` five fields: `input`, `cacheRead`, `output`, `reasoning`, `cacheWrite` (defaults `800 / 50000 / 200 / 0 / 0`). Defaults for `reasoning` and `cacheWrite` 0 so plain `mpc` keeps producing yesterday's numbers; `--reasoning` / `--cache-write` set them.
- **Reasoning bills at output rate *on top of* output.** opencode's store keeps `tokens.output` and `tokens.reasoning` as *separate* counters (one row had `output 14, reasoning 38`, so reasoning not subset of output); store's own provider-priced `cost` reproduces only when reasoning joins output term: GLM-5.3 at 1.4 / 4.4 / 0.26 $/M with 8,689 in · 14 out · 38 reasoning · 128 cache-read is `0.01242668`, exactly `((8689*1.4) + (14+38)*4.4 + (128*0.26))/1e6`. `test/unit/core/cost.test.ts` pins it. Silent underestimate of CommandCode's cost per request for months — its measured reasoning (≈308/req) nearly as large as its output (≈337/req).
- Cache-write rate the model does not publish priced at its **input** rate, never free (`pricing.cacheWrite ?? pricing.input`) — same rule reqshape documents.
- `buildMetrics` / `buildRows` take `Record<ProviderId, Workload>`, not one workload. `collect` resolves both sides to **same** workload (`shape.workload ?? options.workload`), so comparison isolates price and allowance from which traffic went where.
- `--shape` is `data/shape.ts`'s state machine over `constants/shape.ts` specs:
  - `auto` (**the default**): run reqshape, use its profile only when `shape.reqs >=` `SHAPE_MIN_REQS` (both named in `constants/shape.ts`), else fixed workload.
  - `measured`: force reqshape regardless of sample (bare `--shape` maps to this in `map.ts`).
  - `off`: fixed workload (also `""`).
  - anything else: path to saved `reqshape --format json` payload.
- Profile is reqshape's **combined per-req vector** — top-level `profile`, or `shape.perReq` on older payload — rounded to one `Workload` for **both** plans (`collect` prices both sides on `shape.workload ?? options.workload`), so footer line and table show same digits, `req/mo` stays comparable. Measured from **one source**, opencode's own store; mpc no longer reads reqshape's per-side split.
- `loadShapes` returns `{ workload?, note }`, never throws: missing binary, unreadable file or bad payload degrades to fixed workload. `note` is footer's `shape` line — must say plainly **whether reqshape was used**, sample behind `auto`'s decision, alternative flag (`--shape measured` / `--shape off`).
- **Consumer wanting only mpc's catalog must pass `--shape off`.** `auto` shells out to reqshape, and reqshape itself runs `mpc --json`, so bare `mpc --json` from sibling recurses (mpc -> reqshape -> mpc -> ...). reqshape's `loadMpc` and opencode plugin's sidebar both pass `--shape off` for this reason. Backstop: `loadShapes` sets `SHAPE_GUARD_ENV` (`MPC_SHAPE_RESOLVING`) on reqshape child; nested mpc seeing it keeps fixed workload, so cycle breaks even for caller never passing flag (published sibling on old default).
- Footer prints `shape` line after **one** workload line (both sides share a shape); second workload line remains for case where `ReportMeta.workloads` sides ever diverge.

## Ability scores

- `data/bench/` (`index.ts`/`resolve.ts`) resolves benchmark scores; `--bench` picks scheme. `constants/cli.ts`'s `BENCH_DEFAULT` makes default **contextual: `aa` when AA key present (`AA_API_KEY` or `--aa-key`), else `cc`**. Explicit `--bench` always wins — a key only chooses default, upgrades API path.
- **Fill order after lead: same benchmark's keyless `aa-web` scrape, then CommandCode (last resort).** `aa` primary merges `aa-web` then `cc`; `cc` primary merges AA (API when keyed, else `aa-web`); `aa-web`/`file`/`url` fall back to `cc`. `cc`-primary path re-merges `loadCc()` (no-op — primary already loaded it) before AA; CC's pages dropped `Tok/s`, so `cc` primary usually still needs AA fill for speed. `--no-fallback` disables fills entirely.
- `data/sources/aa/` parses `{label, intelligenceIndex, detailsUrl}` dataset embedded in AA flight JSON. Page only embeds its chart top-N, so `aa-web` **partial**; full coverage needs `AA_API_KEY` (`--bench aa`), **paginated** (`pagination.has_more`, page_size 200) — follow every page or most models silently miss. API row shape `{name, slug, evaluations.artificial_analysis_intelligence_index, performance.median_output_tokens_per_second}`, one row per reasoning variant, so keep best per key. AA slugs normalize cleanly via `normalizeKey` (`qwen3-8-max-0902` -> `qwen38max0902`); slug keys win over label keys to keep variant suffixes.
- `aa-web` caches to `$XDG_CACHE_HOME/mpc/ability-aa-web.json` (7d TTL, `--refresh` busts).
- CC's `Intelligence` and AA's index are *same* benchmark (agree to ~2dp), so `cc` primary with its own throughput returns early without AA round-trip; otherwise it, and every non-`cc` primary, fills from `aa-web` then CC per order above.
- Ability and speed come from one source: CC's `Intelligence` and `Tok/s` columns (`BenchData`). Model with no speed figure gets neutral 0.5 in VAL, not penalty.
- `VAL` uses `abilityWeight` (default 0.35) and `tpsWeight` (default 0.10); remaining weight splits volume/cache/output 50/25/25. Unscored models get `valueIndex = null`; never coerce missing score to zero.
- `lookupAbility` makes speed variants (`...Fast`, `...HighSpeed`, `...UltraSpeed`) inherit base model's ability, since weights same. `...FlashX` exception: faster tier of `...Flash`, so inherits `...Flash`, not base. `lookupTps` gives a variant with no throughput of its own the base's ×`SPEED_TPS_FACTOR`: serving differs, but leaving it `null` scored a Fast model at neutral 0.5 — as if mid-pack — which ranked DeepSeek V4.1 Flash Fast below its slower base. Add suffix to `SPEED_SUFFIXES` in `constants/scoring.ts` only when weights really shared.

## Rendering

- `src/view/schema.ts` owns column registry (`COLUMNS`) and grouped table; tiers (`MINIMAL_COLUMNS`, `MEDIUM_COLUMNS`, `DETAIL_COLUMNS`) in `src/constants/view.ts`. Group banner = provider (`planTitle`), so column headers stay unprefixed.
- Provider names: `providerName` (OpenCode/CommandCode, banners and footer) and `shortProviderName` (OC/CC, WIN column). Use these helpers, not literals.
- Default sort `val` (desc). `--metric cost|perreq` ascend, `val|req` descend, `--asc` flips; rows with no VAL always sort last. `cost` sorts by COST index, `perreq` by `$/req`.
- Column selection `cli/flow/columns.ts`: `--columns` (exact) > `--preset` (config) > tier flags > default. **Default tier is `DETAIL_COLUMNS` trimmed to width** — old untrimmed 12-column `DEFAULT_COLUMNS` now `--medium`; `--minimal` 5-column answer (model + req/mo both sides + win + val). `--detail` same content as default, untrimmed, so default and `--detail` differ only by trimming.
- Trimming on by default (`fit: true`), what `--fit` used to be: `trimsToWidth` false only for `--detail`, exact `--columns` list, or `--no-fit`. Two tier flags at once throws rather than silently picking one.
- `fitColumns` drops optional columns, symmetric across providers, when table exceeds terminal width (`process.stdout.columns`, `--width`, else 120). `drop` priority on a `Column`: 1 = `rates`, 2 = `req/$`, 3 = `5h`/`wk`. Columns without `drop` (model, ability, win, COST, VAL) never removed. `tps` drop priority 4.
- `req/$` exactly `1000 / $/1K`; kept because it reads more directly, but not independent information. `$/1K` plan-relative figure.
- **Colour means one thing per code** (`SGR`/`PROVIDER_COLOR`/`PROVIDER_TINT` in `constants/view.ts`). Each provider's **whole column set is tinted** with its identity colour (`PROVIDER_TINT`, plain `36`/`35`), and the bold `PROVIDER_COLOR` (`1;36`/`1;35`) marks the banner, that block's headers, the footer plan rows, and the **winning side's** `$/1K`/`req/$` and WIN cell — so an OC win (cyan) never looks like a CC win (magenta). `COST`/`VAL` and `ability` use the green → orange (`33`) → red scale; `ability` is an absolute index with a narrow band, so `renderText` sets its range from the rendered rows (`setAbilityRange`) and it ranks min-max, reusing the VAL cut-offs. `green` is also favourable (a free model). `dim` = a missing value or a structural annotation only, never a side. `tps` calls `enabledStyle` (plain when present, dim when not). The footer is a key/value list: labels bold, values plain. Auto-off when stdout is not a TTY or `NO_COLOR` is set.

## Sources and drift

Live, per run — no cache. `mpc --check` reports parse counts, unmatched model keys, OpenCode Go live model id count. Docs page changes shape → parsers throw with URL; fix the parser, don't silently fall back.

- **OpenCode Go has two plans; `--oc-plan go|go-plus` picks which** (default `go`, `OC_PLANS` in `constants/sources.ts`). They share one token price list and differ only in per-model monthly limits, so on the docs page the two priced tables have **identical headers** — `creditHeader: /monthly limit/i` matches both, and first-table-wins would silently pin every run to Go. The **tab label** is the discriminator: `parseTabTables` tags each `<table>` with the label of the `role="tabpanel"` it sits in (via the `a[role="tab"]` anchors), and `loadOcGoCatalog` keeps only tables whose label equals the plan's. A **second, equally-synced tab block lists request-count estimates** with no rates; its tables carry no Input/Output columns, so `extractCatalog` rejects them — never re-add a "first table wins" shortcut. `ocGoPlan(entries, planId)` sets `id`/`label`/`price` from the plan. Default (`go`) output must stay byte-identical; `planTitle` replaces the old hardcoded summary string. Fixture tests: `test/unit/scrape.test.ts`.
