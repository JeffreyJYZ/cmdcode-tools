# mpc — model price compare

Compare what the same model actually costs you on OpenCode Go vs CommandCode, using one fixed per-request workload.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@jeffreyjyz/mpc?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/mpc) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

Both providers sell the same shape of thing: a monthly subscription that grants a pool of usage credits, with a per-model allowance priced at API token rates. `mpc` normalises both onto one table so you can see, per model, how many requests a month each plan buys and what each request really costs you.

## Install

Install the published CLI globally:

```sh
bun add -g @jeffreyjyz/mpc
```

Or run it from a checkout — Bun runs the TypeScript entry directly, or link the binary:

```sh
bun install
bun run src/index.ts --help
bun link
mpc --help
```

## Usage

```sh
mpc                                   # oc-go Go vs CommandCode GOAT, default workload
mpc --cc-plan pro                     # compare against CommandCode Pro
mpc --cc-plan go                      # ...or the $1 Go plan
mpc --oc-plan go-plus                 # OpenCode Go Plus ($40) instead of Go ($10)
mpc --minimal                         # model + req/mo both sides + win + val
mpc --medium                          # allowances + the rate views per side
mpc --detail                          # every column, untrimmed (for copy/paste or agents)
mpc --model 'kimi|glm' --metric req   # filter, sort by requests/month
mpc --in 2000 --cache 80000 --out 400 # override the fixed workload
mpc --shape measured                  # force reqshape even on a thin sample
mpc --shape off                       # force the fixed workload (default: auto)
mpc --bench aa-web                    # ability scores from Artificial Analysis
mpc --json                            # machine-readable output
mpc --check                           # validate live sources and report drift
```

Flags are parsed with [cac](https://github.com/cacjs/cac); `--help` and `--version` come from it. Unknown flags and out-of-range values are rejected.

## Your real usage (`--usage`)

Project what you actually ran onto both plans, from the local CommandCode session logs (offline). `--usage-window` picks the range — `period` (the billing cycle, default), `all`, or `<n>d`:

```sh
mpc --usage
mpc --usage --usage-window all
mpc --usage --usage-file ./usage.json            # your own mix (see caveat below)
mpc --usage --usage-months 2                     # scale a partial window to a month
mpc --usage --json                               # full projection
```

Sources, merged when more than one is present:

| source | covers |
| --- | --- |
| **opencode's message store** (`~/.local/share/opencode/opencode.db`, `--usage-db`, `OPENCODE_DB`) | every request opencode ran, for every provider — complete and backfilled |
| external per-request log (`--usage-log`, `MPC_USAGE_LOG`, default `$XDG_CACHE_HOME/mpc/usage.jsonl`) | any harness that writes one JSON line per request; consulted only when the DB is absent |
| `cmduse model --json --since <ISO>` (windowed model reports) | CommandCode CLI sessions on this machine |
| session-log scan (`~/.commandcode/projects`) | fallback when cmduse lacks the window |
| `--usage-file` | anything else you have |

The DB is read-only via `bun:sqlite`; assistant messages carry `cost`, `tokens` and `modelID`/`providerID`, so no plugin is required for the opencode side. Set `CMDUSE_BIN` to test against a dev cmduse (`cmdusedev`).

**Scope caveat.** Only *local* sources exist — the account API exposes totals, not per-model usage, and Studio's API surface is the same endpoint. The report prints a coverage line (`local usage N of M account requests (x%)`) and warns below 90%, so a partial mix is visible rather than silently wrong.

```text
MODEL          your req    your $    CC $/req  CC $/mo    OC $/req  OC $/mo  cheaper
GLM-5.2             142  $15.7237     $0.0158  $2.2462     $0.0185  $2.6206  CC
GLM-5.3 Flash        29   $0.7203  $0.0062091  $0.1801  $0.0041394    $0.12  OC
totals  your mix · CC $2.4761/mo · OpenCode $2.7686/mo
        head-to-head  2 of 2 models · CC $2.4761/mo · OpenCode $2.7686/mo · cheaper CommandCode by $0.2925 (12%)
```

Usage is per-model **totals**, so `your $` is the list value of the tokens, `CC $/mo` is what that subscription would cost you, and models that exceed a plan's allowance are flagged `over cap`. The `head-to-head` line answers "which plan is cheaper *for my mix*", so it is restricted to the models **both** plans price — a model only one provider sells would otherwise pad that side's total and "prove" the other cheaper on traffic it cannot serve. One-sided rows are excluded and counted. Unknown models are listed, never dropped. Accepts the cmduse shape, `{"entries": [...]}`, or a bare array of `{ model, requests, tokensIn, cacheRead, tokensOut }`.

## Config file

Every flag persists. `mpc` reads `~/.config/mpc/config.json` (or `$XDG_CONFIG_HOME/mpc/config.json`), overridden by CLI flags, and `--config <path>` / `--no-config` control it. Keys are the camelCase flag names, negations are plain booleans:

```json
{
  "ccPlan": "goat",
  "ocPlan": "go",
  "columns": ["model", "oc-per1k", "cc-per1k", "val"],
  "presets": { "cheap": ["model", "oc-per1k", "cc-per1k", "cost"] },
  "metric": "val",
  "benchWeight": 0.4,
  "valWeights": [0.4, 0.1, 0.25, 0.15, 0.1],
  "color": false,
  "plugins": ["./work.json", "mpc-preset-openai"]
}
```

`--print-config` prints the effective settings.

### Plugins

`plugins` (or `--plugin a,b`) layer config fragments between the defaults and your config:

```text
defaults  <  plugins (listed order)  <  user config  <  CLI flags
```

Relative paths resolve against the config file's directory. A plugin is a `.json` file, or a `.js`/`.ts`/package whose default export is a config object (or a sync/async function returning one, given `{ env, cwd, configDir }`). JS plugins run code — same trust as your shell.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--cc-plan <id>` | `goat` | CommandCode plan: `go`, `goat`, `pro`, `max10`, `max20` |
| `--oc-plan <id>` | `go` | OpenCode Go plan: `go`, `go-plus` (same token rates, higher per-model limits) |
| `--in <n>` | `800` | fixed input tokens per request |
| `--cache <n>` | `50000` | fixed cache-read tokens per request |
| `--out <n>` | `200` | fixed output tokens per request |
| `--reasoning <n>` | `0` | reasoning tokens per request, billed at the output rate on top of output |
| `--cache-write <n>` | `0` | cache-write tokens per request; a model that publishes no cache-write rate is priced at its input rate |
| `--shape <spec>` | `auto` | `auto` = reqshape's measured profile when it has ≥ `SHAPE_MIN_REQS` (500) reqs, else the fixed workload; `measured` forces reqshape; `off` keeps the fixed workload; a path reads a saved `reqshape --format json` payload |
| `--since <date>` | — | measured shape: only requests on or after this date |
| `--metric <name>` | `val` | sort by `val`, `cost`, `perreq`, `req` or `name`; `cost` and `perreq` ascend (lower better), `val`/`req` descend, `--asc` flips; rows with no `VAL` always sort last |
| `--model <re>` | — | filter rows by name (regex, substring fallback) |
| `--only <scope>` | `all` | `all` = union of both catalogs, `both` = only shared models |
| `--width <n>` | terminal | force table width; by default the table trims to the terminal and drops optional columns (`rates`, `req/$`, `5h`/`wk`) until it fits |
| `--minimal` | off | fewest columns: model + req/mo both sides + win + val |
| `--medium` | off | preset: allowance and the rate views per side + win + cost + val |
| `--no-fit` | off | keep the preset's full width instead of trimming to the terminal |
| `--columns <ids>` | preset | comma-separated columns to show, in order (overrides presets and trimming); `--columns help` lists ids |
| `--bench <src>` | `aa` with a key, else `cc` | ability scores: `cc`, `aa`, `aa-web`, `file:<path>`, `url:<url>` |
| `--bench-weight <n>` | `0.35` | ability share of `VAL`, 0-1 |
| `--tps-weight <n>` | `0.10` | output-speed share of `VAL`, 0-1 |
| `--bench-name <label>` | source | footer label for the ability source |
| `--aa-key <key>` | `AA_API_KEY` | Artificial Analysis API key |
| `--no-fallback` | off | skip filling ability misses from the other sources |
| `--refresh` | off | ignore the `aa-web` cache |
| `--no-ability` | off | hide `ability` and `VAL` |
| `--preset <name>` | — | named column set from `presets` in config |
| `--val-weights <a,b,c,d,e>` | see above | VAL weights (ability, tps, volume, cache, output) |
| `--scale <mode>` | `log` | `log` or `linear` normalisation for skewed terms |
| `--inherit-suffixes <s>` | built-in | speed-variant suffixes that inherit ability |
| `--window <five,week>` | derived | override rolling-window ratios |
| `--cost-thresholds <g,y>` | `30,60` | COST colour cut-offs |
| `--val-thresholds <y,g>` | `40,70` | VAL colour cut-offs |
| `--format <name>` | `table` | `table`, `json`, `csv`, `md` |
| `--color <mode>` | `auto` | `auto`, `always`, `never` |
| `--config <path>` | XDG | config file |
| `--no-config` | off | ignore config and plugins |
| `--plugin <paths>` | — | extra config plugins, comma-separated |
| `--print-config` | — | print effective settings and exit |
| `-h, --help` | — | generated help (cac) |
| `-v, --version` | — | print version |
| `--peak` | off | use peak-rate rows instead of off-peak (DeepSeek) |
| `--asc` | off | sort ascending |
| `--detail` | off | every column, untrimmed; the default is every column trimmed to the terminal width |
| `--json` | off | emit JSON instead of a table |
| `--no-color` | off | disable ANSI colour |
| `--check` | off | validate sources, list unmatched models, exit |

## Data sources (all fetched live)

| Source | Provides |
| --- | --- |
| `cmduse plans --json` | CommandCode plan price, credits, 5h/weekly windows |
| `commandcode.ai/docs/plans/{goat,pro,max}` | per-model credits + token rates |
| `opencode.ai/docs/go/` | oc-go per-model monthly limit (per Go plan) + shared token rates |
| `opencode.ai/zen/go/v1/models` | oc-go live model list (`--check` drift) |

## Reading the table

| Column | Meaning |
| --- | --- |
| `in/out/cache` (`--detail`) | model token rates, USD per 1M tokens |
| `allow` | monthly credits this plan devotes to that model |
| `req/5h`, `req/wk` (`--detail`) | requests the plan's rolling 5-hour / weekly window allows |
| `req/mo` | requests the allowance buys (`allowance / costPerRequest`) |
| `$/1K` | what 1,000 requests cost you on the plan |
| `req/$` | requests one dollar of subscription buys |
| `ability` | benchmark score for the model |
| `tps` | output tokens per second |
| `WIN` | side with the lower per-request cost |
| `COST` | 0-100 volume index: `requests/mo`, **lower is better** (no ability) |
| `VAL` | 0-100 ability-aware value score |

`--columns a,b,c` picks and orders columns; ids are listed under `--columns help`, and `cc-*` mirrors the `oc-*` set. Without it, plain `mpc` shows every column that fits the terminal, `--minimal` and `--medium` narrow the set, and `--detail` prints all of them untrimmed.

Colour carries one meaning per code. Each provider's whole column set is tinted in its own colour — **cyan** for OpenCode, **magenta** for CommandCode — and the bold form of that colour marks the group banner, the block's headers, the footer plan rows, and the **winning side**: the WIN cell and the cheaper side's `$/1K` / `req/$`. So an OpenCode win (cyan) never looks like a CommandCode win (magenta). `COST`, `VAL` and `ability` run green → orange → red — `ability` is ranked relative to the table, like the other two — and a free model is green. Dim is reserved for a missing value or a footnote. `--no-color`, or stdout that is not a terminal, turns it all off.

Rolling-window columns scale the monthly figure by each plan's own window ratio (OpenCode Go fixes 5h = 20%, weekly = 50%; CommandCode derives it from the plan's 5h/weekly dollar caps — 20%/50% on GOAT and Pro, 30%/60% on the Max plans).

`--json` reports the raw `costPerRequest`, `payPerRequest`, `requestsPerMonth`, `requestsPerFiveHour`, `requestsPerWeek`, `multiplier` and `index` per model-provider, plus a `tally` object.

The footer keeps a running **win tally** over head-to-head models (`oc-go N · cc M · tie T`) plus exclusive counts for models only one provider carries.

## How the numbers are computed

For a fixed workload of `IN` input, `CACHE` cache-read, `OUT` output, `RSN` reasoning and `CW` cache-write tokens:

```text
costPerRequest   = (IN*input + CACHE*cacheRead + (OUT+RSN)*output + CW*cacheWrite) / 1e6   # USD, list rates
requestsPerMonth = allowance / costPerRequest
payPerRequest    = planPrice * costPerRequest / allowance            # what you really pay
multiplier       = allowance / planPrice                             # $usage per $paid
```

Reasoning bills at the output rate *on top of* output — opencode's own provider-priced rows reproduce exactly that way (a GLM-5.3 turn of 8,689 input / 14 output / 38 reasoning / 128 cache-read is priced at `0.01242668`, which only matches when reasoning joins the output term). A cache-write rate the model does not publish falls back to its input rate rather than to free.

### Measuring instead of assuming

By default mpc asks **reqshape** for the shape of your real traffic, read from opencode's own store, and prices **both** plans on that single per-req profile, so the comparison isolates price and allowance from traffic and the footer prints one workload line. reqshape only leads once it has `SHAPE_MIN_REQS` (500) measured requests — below that the fixed 800/50K/200 workload is steadier. The footer's `shape` line says plainly which was used, the sample size behind the choice, and the alternative flag.

`req/mo` then answers "how many of *my* requests fit this allowance" rather than "how many of a hypothetical 800/50K/200 ones do". Force the fixed workload with `--shape off`, force reqshape regardless of sample with `--shape measured`, or save a payload once with `reqshape --format json > shape.json` and reuse it with `--shape shape.json`; `--since <date>` narrows the window. A missing `reqshape` binary (`REQSHAPE_BIN` overrides it) is a warning, not a failure: mpc keeps the fixed workload and carries on.

The **index** behind `COST` is a 0-100 volume score across every model-provider entry:

```text
index = 100 * volume
```

where `volume` is min-max normalised `log10(requestsPerMonth)`. Cache and output prices are **not** folded in — they are their own columns — so `COST` reads as "how many requests the plan buys". Free models get `∞` requests and `index = 100`.

## Ability scores (`VAL`)

`VAL` adds a benchmark term alongside the same volume/price terms:

```text
COST = 100 - 100·volume                                     # inverted: 0 is best
VAL = 100 * (0.35*ability + 0.10*tps + 0.25*volume + 0.15*cache + 0.15*output)
```

`--bench-weight` and `--tps-weight` set the ability and speed shares; the remaining weight splits volume/cache/output 50/25/25. Ability and `tps` come from the same source, so `--bench cc` reads both CommandCode's `Intelligence` and `Tok/s` columns. Speed variants (`…Fast`, `…HighSpeed`, `…UltraSpeed`, `…FlashX`) inherit their base model's ability — same weights — and, when the benchmark publishes no throughput for the variant, the base's throughput ×`SPEED_TPS_FACTOR` (a speed tier is multiples of its base). Without that a Fast model was scored at the neutral rate, ranking it below its slower base. Unscored models show `ability —` and `VAL —` and are excluded from the ability normalisation range.

| `--bench` | source | coverage |
| --- | --- | --- |
| `aa` | Artificial Analysis API (paginated) | full; needs `AA_API_KEY` |
| `aa-web` | Artificial Analysis models page scrape | partial (only the models AA embeds) |
| `cc` | CommandCode's `Intelligence` column | every matched model |
| `file:<path>` / `url:<url>` | your JSON, `{ "model": score }` or `[{ model, score }]` | whatever you supply |

The default is `aa` when an AA key is available (`AA_API_KEY` or `--aa-key`), otherwise `cc`; an explicit `--bench` always wins. After the lead source, misses are filled from the same benchmark's keyless page scrape (`aa-web`) and then from CommandCode, the last resort — `--no-fallback` disables the fills. Because CC's `Intelligence` column and AA publish the same index, a `cc`-led run asks AA only when it still lacks throughput (CC's plan pages no longer publish `Tok/s`). The `aa-web` result is cached under `$XDG_CACHE_HOME/mpc/` (or `~/.cache/mpc/`) for 7 days; `--refresh` busts it.

## Model matching

Names from the two catalogs are collapsed onto one canonical key (lowercase, vendor prefix stripped, punctuation removed, parenthetical qualifiers dropped), with a small alias table for branding differences (`Tencent Hy3` ↔ `hy3`, `…Vision (exp)` ↔ `…vision-exp`, `…Free` ↔ the base model). Models present on only one side still appear; the other column shows `—`.

## Notes and limits

- CommandCode plans are read from their docs pages: `goat`, `pro` and the Max plans list explicit per-model credits; the **Go** ($1) plan publishes only a rate list, so every model draws on the plan's whole $10 credit pool.
- Models CommandCode lists with rates but no explicit credits row (the "older models also available" set) use the documented standard allowance ($20 on GOAT, $30 on Pro).
- OpenCode sells two Go plans — **Go** ($10/mo) and **Go Plus** ($40/mo) — with identical token rates but different per-model monthly limits; `--oc-plan` picks which. Go has no shared credit pool, so the plan's "credits" figure is the sum of the per-model limits (an upper bound, not a pool).
- OpenCode Go's free models (`LongCat 2.5 Preview Free`, `Step 5 Preview Free`) publish an `Unlimited` monthly limit instead of a $ figure. They are included as free entries — `$0` rates, unbounded `req/mo` — and, since their allowance is meaningless at zero cost, they add nothing to the plan's summed credits. Their docs-only `… Free` suffix is aliased to the base key, so a variant merges onto the model's one row instead of appearing twice.
- `$/1K` and `req/$` are plan-relative: they divide by the plan's own price, so a cheaper subscription can post a lower per-request cost while buying fewer requests. Compare `req/mo` for volume and `$/1K` for the effective rate.
- Values reflect the docs at fetch time; active deals are picked up automatically.

## Development

```sh
bun install
bun test          # unit tests (parsers, normalisation, metrics)
bun run typecheck # tsc --noEmit
bun run check     # biome format + lint (write)
```

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/oc-cmd-compare)
- [npm: @jeffreyjyz/mpc](https://www.npmjs.com/package/@jeffreyjyz/mpc)
- [MIT license](LICENSE)
