# Shared contract — `aa-models` (lane A/B/C/D all read this first)

New bun workspace package in `/Users/jyz/dev/cmdcode-tools`. It is the Artificial Analysis model
catalogue as a CLI: lists models, emits the full record as JSON, filters/sorts, and is importable by other
packages (`mpc` will consume it in a later lane).

- dir `aa-models/`, package `@jeffreyjyz/aa-models`, version `0.1.0`, licence MIT.
- bins `aa` and `aadev`, both `src/index.ts` (the `aadev` twin is the convention: `scripts/dev-link.ts`
  links dev names so an installed `aa` is never shadowed — do not edit that script, another lane owns it
  only if this brief says so).
- runtime dependency: `cac` only. Dev: `@biomejs/biome`, `@types/bun`, `typescript: ^7`.
- `"imports": { "#~/*": "./src/*" }` — package-scoped subpath import, NOT a tsconfig path. `"files":
  ["src", "LICENSE"]`, `"publishConfig": {"access": "public"}`. Copy the shape of `reqshape/package.json`.
- Formatting: the repo root `bunfig.toml` already sets tabs, `tabWidth 4`, `printWidth 100` — inherit it,
  do not add a local one. Linting: `bunx biome lint` (repo default). Do not add Prettier.

## File ownership (do not write outside your lane's list)

| lane | files |
| --- | --- |
| A | `src/model.ts`, `src/sources/flight.ts`, `src/sources/leaderboard.ts`, `src/sources/keys.ts`, `src/sources/normalize.ts`, `src/sources/api.ts`, `src/sources/index.ts`, `src/sources/lastGood.ts`, `test/sources/*` |
| B | `src/sources/manifest.ts`, `src/sources/discover.ts`, `test/manifest/*`, `scripts/fetch-fixtures.ts` |
| C | `src/filter.ts`, `src/sort.ts`, `src/view/table.ts`, `src/view/format.ts`, `src/view/help.ts`, `test/view/*` |
| D | `src/index.ts`, `src/cli/*`, `package.json`, `README.md`, `LICENSE`, root `package.json` workspaces entry, `biome.json` |

A also owns `src/model.ts`, which is the one file everyone types against. If you need a field it does not
have, message the owner (do not edit another lane's file) — `docs/agents/aa-<lane>.md` is where you note it.

## The model record

```ts
export interface Release {
	slug: string | null;
	name: string | null;
	/** ISO date (YYYY-MM-DD) when AA states one. */
	date: string | null;
}

export interface Model {
	/** AA's own slug: the identity. One entry per slug, never per effort variant. */
	slug: string;
	name: string;
	shortName: string | null;
	creator: string | null;
	release: Release;
	/** Every join key a consumer may match on (aaKeyVariants output: slug, dated form, effort-stripped form, display name). */
	keys: string[];
	/** AA's Intelligence Index. null = listed but unmeasured. Never 0 as a stand-in. */
	intelligenceIndex: number | null;
	/** Median output tokens/second. */
	outputSpeed: number | null;
	/** First-token latency in seconds, when published. */
	latency: number | null;
	contextWindow: number | null;
	maxOutputTokens: number | null;
	/** USD per 1M tokens, when AA publishes a price. */
	price: { input: number | null; output: number | null; blended: number | null } | null;
	openWeights: boolean | null;
	modalities: { input: string[]; output: string[] };
	/** Reasoning support and the effort labels AA lists. */
	reasoning: { supported: boolean | null; efforts: string[] };
	/** Every other scalar AA publishes for this model, keyed by AA's own field path (dot-joined). Never invented. */
	evals: Record<string, number>;
	/** Effort-variant rows collapsed into this model: label + the figures that differ. */
	variants: Array<{ slug: string; label: string | null; intelligenceIndex: number | null; outputSpeed: number | null }>;
	/** Which sources contributed: "manifest" | "leaderboard" | "models" | "api". */
	sources: string[];
	/** The untouched upstream record(s). Only included when `--raw` is passed. */
	raw?: unknown;
}
```

Populate a field only from a value AA actually published. A missing number stays `null`; never coerce
`null`/`0` into a score, and never carry a number forward from a different model. `evals` is the escape
hatch for everything not modelled above: walk the upstream record, keep every finite number under a
stable dot-path, and ignore arrays/objects that are not scalars.

## `loadCatalogue()` — one entry point, implemented in `src/sources/index.ts` (lane A)

```ts
export interface LoadOptions {
	/** AA API key; absent means keyless sources only. */
	apiKey?: string;
	/** Skip the API even when a key exists. */
	noApi?: boolean;
	/** Force a refetch, ignoring the cache. */
	refresh?: boolean;
	/** Cache TTL in ms; 0 disables reads and writes. */
	cacheTtlMs: number;
}
export interface Catalogue {
	models: Model[];
	/** Which loaders answered, e.g. ["manifest", "leaderboard"]. */
	sources: string[];
	indexVersion: string | null;
	fetchedAt: string;
	/** True when this came from the last-good fallback rather than a live fetch. */
	stale: boolean;
	/** Non-fatal problems, one line each, for the footer and `--json`. Empty when clean. */
	notes: string[];
}
export async function loadCatalogue(options: LoadOptions): Promise<Catalogue>;
```

Behaviour:

- Lead with the **manifest** (lane B) when it answers — it is the full covered set. Merge the
  **leaderboard** scrape (lane A) for index/speed, then the **API** (lane A) when a key exists. Merge by
  slug first, then by shared join key. A higher score never gets overwritten by a lower one.
- Live every run unless a cache TTL is set. A cache hit must say so (`notes`), and `--refresh` bypasses it.
- **Never persist an empty catalogue** — the bug that killed mpc's old cache was one bad run writing an
  empty set that every later run inherited.
- Fail soft per source: one dead source must not blank the list. Push the reason into `notes` and keep
  going. A total failure throws with the URL, so `aa check` and the user see which endpoint broke.
- No source may be trusted for a field it does not publish; `sources` per model records the provenance.

## Output contract

`--json` prints exactly:

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
	"models": [ /* Model[] after filters and sort */ ]
}
```

`total` is the catalogue size before filters, `count` after. `--format csv` and `--format md` render the
same rows in the selected column set. `--raw` adds `raw` to each model in JSON only.

## CLI surface (lane D implements, everyone else must not depend on unlisted flags)

```
aa                        list every model (default sort: intelligence desc, unscored last)
aa model <slug|key|name>   one model's full record; exit 1 when nothing matches
aa fields                 every field present across the loaded catalogue, with coverage counts
aa check                  validate each source, print counts/versions/notes, exit 1 on a broken source
aa --json                 the output contract above
```

Flags: `--model <re>` (name/slug/creator, case-insensitive regex, substring fallback), `--creator <list>`
(comma), `--where <expr>` (repeatable: `path op value`, ops `= != > >= < <= ~`), `--scored`/`--unscored`,
`--min-intel/--max-intel`, `--min-tps/--max-tps`, `--min-context`, `--open-weights`/`--closed-weights`,
`--since <date>`, `--sort <field>`, `--asc`, `--rows <n>` (0 = all), `--columns <ids>` (`--columns help`),
`--format table|json|csv|md`, `--json`, `--raw`, `--no-api`, `--aa-key <key>`, `--refresh`,
`--cache <dur>` (`0`, `30s`, `15m`, `6h`, `1d`; default `1h`), `--width <n>`, `--color auto|always|never`,
`--check`, `--fields`, `--print-config`? (no config file in v1).

Env: `AA_API_KEY`, `AA_CACHE_DIR` (default `$XDG_CACHE_HOME/aa-models` or `~/.cache/aa-models`).

## House rules for every lane

- `rg`/`fd` only, with an explicit path. Never `grep`, `find`, `sed`.
- One tree — no worktree. Do not touch another session's files or processes.
- Aim ~100 lines per file, hard cap **150**; max **6** entries per directory. Tests count toward the cap.
- No network in tests: pin fixtures on disk and test the pure parsers.
- No version bumps, tags or publishing. No `AGENTS.md` edits — record what you learned in
  `docs/agents/aa-<lane>.md` and say it in the report.
- `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint` must pass in the package before you report.
  Run them in the foreground and wait.
- Report to `docs/plan/aa-cli/reports/<lane>.md` with the commands you ran and their verdicts.
