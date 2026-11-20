# Lane D — CLI, package, README, workspace wiring

## What landed

- `aa-models/package.json` — `@jeffreyjyz/aa-models` 0.1.0, bins `aa` + `aadev` at `src/index.ts`,
  `imports` `#~/*`, `files: ["src","LICENSE"]`, `publishConfig.access: "public"`, `cac` only runtime dep,
  dev deps `@biomejs/biome ^2.5.13`, `@types/bun latest`, `typescript ^7`, scripts `start`/`test`/`lint`/
  `typecheck`/`dev:link` (links `aadev`). `repository.directory: "aa-models"`.
- `aa-models/LICENSE` — MIT text copied from `reqshape/LICENSE`.
- `aa-models/tsconfig.json` — not in any lane's file list, but `bun check` needs one; copied from
  `reqshape/tsconfig.json`. Flagged here rather than silently added elsewhere.
- `aa-models/biome.json` — formatter disabled (Bun formats), `$schema` pinned to installed Biome 2.6.7.
- Root `package.json` `workspaces`: added `"aa-models"` as the first entry. `bun install` at the root
  updated `bun.lock` with the workspace entry.
- `src/index.ts` — thin entry, `process.exitCode = await run(...)`, errors as `aa: <message>`, exit 1.
- `src/cli/options.ts` — `Options`, `--cache` duration parsing (`0`/`30s`/`15m`/`6h`/`1d`, default 1h),
  validators that reject a bare boolean or blank string instead of coercing it.
- `src/cli/parse.ts` — every declared flag plus the `model`/`fields`/`check` subcommands; `KNOWN`/`VALUED`
  sets; help/version detected before any work.
- `src/cli/map.ts` — bag → `Options`: unknown flag throws, bare value flag throws naming itself,
  `--scored`/`--unscored` and `--open-weights`/`--closed-weights` throw, `--columns help` becomes a help
  request, `--json` selects the JSON format.
- `src/cli/output.ts` — the contract envelope (exact key order), raw stripped unless `--raw`, CSV and
  Markdown renderers over the shared column registry, the table footer, and the labelled record for
  `aa model`.
- `src/cli/commands.ts` — `aa model` (exact slug → exact key → filter; ambiguity lists candidates and
  exits 1), `aa fields` (non-null dot-paths with model counts), `aa check` (per-source counts, index
  version, scored/total coverage; exit 1 when no source produced a model).
- `src/cli/run.ts` — parse → options → `loadCatalogue` → `applyFilters` → `sortModels` → one renderer;
  JSON prints the envelope and nothing else. Filter notes are merged into the catalogue notes before
  either output, so `--json` and the footer both show them.
- `test/cli/` — 22 hermetic tests: unknown flag, bare value flag, `--cache 15m` → 900000 ms, `--cache soon`
  rejected, mutual exclusion, `--json` key set and count/total, raw opt-in, unknown `--where` note,
  `--rows 0` preserved as 0 (renderer reads 0 as all), `--columns help`, subcommand mapping, `aa model`
  ambiguity/no-match, `aa fields` counts, `aa check` exit codes.
- `README.md` — the canonical docs page: title, tagline, flat-square badges, `## What it is`,
  `## Install`, `## Usage`, `## Commands`, `## Flags` (one line each), `## JSON output` (contract block
  verbatim plus the `Model` record), `## Links`. No hardcoded version in prose; every fence tagged.

## Commands run and verdicts

From `aa-models/`:

- `bun test test/cli` — **22 pass, 0 fail**.
- `bun test` — **103 pass, 0 fail** (whole package, all lanes).
- `bun check` — **no type errors in 38 files**.
- `bun fmt README.md src/index.ts src/cli test/cli` — clean for my files; `bun fmt --check` across the
  package still lists lanes A/B files (`src/model.ts`, `src/sources/api.ts`, `src/sources/leaderboard.ts`,
  `src/sources/normalize.ts`, two fixture HTML files).
- `bunx biome lint src/index.ts src/cli test/cli` — **clean**. Package-wide `bunx biome lint` still
  reports 3 `lint/a11y/useHtmlLang` errors in lane A/B fixture HTML (`test/manifest/homepage.html`,
  `test/sources/fixtures/{leaderboard,models}.fixture.html`); those are not mine to edit.

## Live proof (keyless; `AA_API_KEY` not set)

```
$ aa --refresh --rows 2
NAME           CREATOR  INTEL   T/PS   CTX  IN  OUT  RELEASED    OPEN
GPT-6 Sol      OpenAI    64.6  460.9  1.0M  $2  $10  2026-09-22  closed
GPT-5.2 Codex  OpenAI    61.4  163.8  1.0M  $3  $15  2025-12-11  closed
… 382 more

384 of 384 models · from manifest + leaderboard + models
```

```
$ aa --json --rows 3 | head -12
{
	"schema": "aa-models/1",
	"sources": ["manifest", "leaderboard", "models"],
	"indexVersion": null,
	"fetchedAt": "2026-11-20T09:47:52.785Z",
	"stale": false,
	"notes": [],
```

Key set confirmed by script: `schema, sources, indexVersion, fetchedAt, stale, notes, total, count,
models`; `count` 384, `total` 384. `indexVersion` is `null` keyless — only the API carries it.

```
$ aa fields | head -8
creator            384
keys               384
name               384
openWeights        384
reasoning.supported 384
...
```

```
$ aa check
manifest     384 models
leaderboard  154 models
models       8 models
coverage       42 scored / 384 total
$ echo $?
0
```

Error paths, quoted exactly:

```
$ aa --cache soon
aa: --cache expects a duration: 0, 30s, 15m, 6h or 1d        (exit 1)
$ aa --sort
aa: --sort expects a value — see --help                       (exit 1)
$ aa --scored --unscored
aa: --scored and --unscored are mutually exclusive             (exit 1)
```

Also exercised live: `--format csv`, `--format md`, `--columns help`, `--rows 0 --min-intel 64`,
`aa model gpt-6-sol`, `aa model deepseek` (19 candidates, exit 1).

## Cross-lane defects found while proving the CLI (not fixed here)

1. **`keys` are polluted on at least one model.** `gpt-6-sol` carries 35 foreign keys (`claudesonnet55`,
   `glm53`, `kimik31pro`, …), so `--model` matches unrelated models and `aa model` resolves them to it.
   Evidence: `c.models.filter(m => m.keys.includes("claudesonnet55"))` → exactly `["gpt-6-sol"]`;
   average `keys` length 2.0, max 57. Lane A/B: a row's key list is being taken from another record.
2. **`evals` collapses to 216 keys on that same model**, and package-wide the fields view shows
   `evals.score` on 356 models — looks like nested eval objects losing their parent path.
3. **`latency: 275.15632001638` for GPT-6 Sol** — if AA publishes milliseconds this is being stored as
   seconds; worth a unit check in the normalizer.
4. **`intelligenceIndex` keeps full float precision** (`64.563595756626`). Fine for JSON; the table
   formats it, but consumers may want it noted.

## Notes for follow-up

- No config file in v1, so `AA_API_KEY` and `AA_CACHE_DIR` are the only environment surface; the key is
  read in `run.ts` (`--aa-key` wins) and passed through `LoadOptions.apiKey`.
- `--rows` is table-only: JSON always carries every filtered model (the contract's `count`), CSV/MD always
  carry every row. The table itself prints `… N more` for the cap.
- Root `scripts/dev-link.ts` still only links the four older dev names; `aadev` is linked by this package's
  own `bun run dev:link` because the contract put that script out of lane D's scope.
