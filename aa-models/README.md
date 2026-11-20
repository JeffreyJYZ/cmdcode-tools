# aa-models

The Artificial Analysis model catalogue as a CLI: list every model, filter and sort it, and emit the full record as JSON.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@jeffreyjyz/aa-models?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/aa-models) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

Artificial Analysis publishes benchmark scores, output speed and token prices for a growing catalogue of models, spread across a leaderboard page, a models page, a manifest and an API. `aam` merges every source it can reach into one `Model` record per slug, keeping only the values AA actually published: a missing number stays `null`, never `0`, and nothing is carried across from a different model.

It is built to be consumed. `mpc` imports the catalogue for ability scores, and any script can read `aam --json` for the same data, with a stable `aa-models/1` schema and one row per model rather than per effort variant.

## Install

Install the published CLI globally:

```sh
bun add -g @jeffreyjyz/aa-models
```

Or run it from a checkout:

```sh
bun install
bun run src/index.ts --help
```

Working on the CLI itself? `bun run dev:link` points `aamdev` at this checkout, so an installed `aam` is never shadowed:

```sh
bun run dev:link
aamdev --rows 5
```

## Usage

```sh
aam                                    # every model, intelligence descending, unscored last
aam --scored --open-weights             # only measured open-weights models
aam --where "price.blended<1" --sort tps # cheaper than $1 blended, fastest first
aam model glm-5.3                       # one model's full record
aam fields | head                       # what AA actually publishes
aam check                               # validate each source
```

The keyless path works out of the box: the full manifest and the leaderboard scrape need no credentials. Set `AA_API_KEY` (or pass `--aa-key`) to add the API, which covers more rows and the in-band `intelligence_index_version`. Without a key you lose the API's paginated full list and whatever only that endpoint publishes; every scraped field still arrives.

## Commands

```sh
aam                        list every model (default sort: intelligence desc, unscored last)
aam model <slug|key|name>   one model's full record; exit 1 when nothing matches
aam fields                 every field present across the loaded catalogue, with coverage counts
aam check                  validate each source, print counts/versions/notes, exit 1 on a broken source
aam --json                 the output contract below
```

## Flags

| flag                                  | what it does                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--model <re>`                        | keep models whose name, slug or keys match a case-insensitive regex (substring when the pattern is invalid) |
| `--creator <list>`                    | comma-separated creators, exact and case-insensitive                                                        |
| `--where <expr>`                      | `path op value` with `= != > >= < <= ~`; repeatable, all clauses AND together                               |
| `--scored`                            | only models carrying an intelligence index                                                                  |
| `--unscored`                          | only models without one; mutually exclusive with `--scored`                                                 |
| `--min-intel <n>` / `--max-intel <n>` | intelligence index bounds; an unscored model fails both                                                     |
| `--min-tps <n>` / `--max-tps <n>`     | output-speed bounds in tokens/second                                                                        |
| `--min-context <n>`                   | minimum context window in tokens                                                                            |
| `--open-weights` / `--closed-weights` | keep one side of the open-weights split; mutually exclusive, and `null` fails both                          |
| `--since <date>`                      | released on or after `YYYY-MM-DD`; a model with no date fails                                               |
| `--sort <field>`                      | dot-path, or an alias: `intelligence`, `tps`, `context`, `price`, `released`, `name`                        |
| `--asc`                               | ascending order; nulls stay last either way                                                                 |
| `--rows <n>`                          | cap table rows; `0` means all                                                                               |
| `--columns <ids>`                     | exact column set; `--columns help` lists them                                                               |
| `--format <name>`                     | `table`, `json`, `csv` or `md`                                                                              |
| `--json`                              | machine-readable output, same as `--format json`                                                            |
| `--raw`                               | add each model's untouched upstream record in JSON only                                                     |
| `--no-api`                            | skip the API even when a key exists                                                                         |
| `--aa-key <key>`                      | Artificial Analysis API key (else `AA_API_KEY`)                                                             |
| `--refresh`                           | refetch, ignoring the cache                                                                                 |
| `--cache <dur>`                       | cache TTL: `0`, `30s`, `15m`, `6h`, `1d` (default `1h`)                                                     |
| `--width <n>`                         | table width (default terminal width, then 120)                                                              |
| `--color <mode>`                      | `auto`, `always` or `never`; `NO_COLOR` is honoured                                                         |
| `--check`                             | same as `aam check`                                                                                         |
| `--fields`                            | same as `aam fields`                                                                                        |

Environment: `AA_API_KEY` for the key, `AA_CACHE_DIR` for the cache directory (default `$XDG_CACHE_HOME/aa-models` or `~/.cache/aa-models`).

## JSON output

`--json` prints exactly this object and nothing else on stdout — no banner, no footer:

```json
{
	"schema": "aa-models/1",
	"sources": ["manifest", "leaderboard"],
	"indexVersion": "v5.0.1",
	"fetchedAt": "2026-11-20T00:00:00.000Z",
	"stale": false,
	"notes": [],
	"total": 757,
	"count": 146,
	"models": []
}
```

`total` is the catalogue size before filters, `count` after. `notes` carries non-fatal problems, one line each: a stale cache replay, a dead source, a `--where` path nobody matched. `stale: true` means the rows came from the last-good fallback rather than a live fetch. Each entry in `models` is a `Model`:

```ts
interface Model {
	slug: string;
	name: string;
	shortName: string | null;
	creator: string | null;
	release: { slug: string | null; name: string | null; date: string | null };
	keys: string[];
	intelligenceIndex: number | null;
	outputSpeed: number | null;
	latency: number | null;
	contextWindow: number | null;
	maxOutputTokens: number | null;
	price: { input: number | null; output: number | null; blended: number | null } | null;
	openWeights: boolean | null;
	modalities: { input: string[]; output: string[] };
	reasoning: { supported: boolean | null; efforts: string[] };
	evals: Record<string, number>;
	variants: Array<{
		slug: string;
		label: string | null;
		intelligenceIndex: number | null;
		outputSpeed: number | null;
	}>;
	sources: string[];
	raw?: unknown;
}
```

`evals` is the escape hatch: every other finite scalar AA publishes for the model, keyed by AA's own field path. `raw` appears only with `--raw`.

## Links

- [Artificial Analysis](https://artificialanalysis.ai)
- [Issues](https://github.com/JeffreyJYZ/cmdcode-tools/issues)
- [Source](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/aa-models)
