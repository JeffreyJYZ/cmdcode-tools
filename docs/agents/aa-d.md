# aa-models lane D notes

Measured facts and traps from the CLI/package half.

- **`tsconfig.json` is required but unowned** — `bun check` type-checks only files a tsconfig includes;
  copied `reqshape/tsconfig.json` (`include: ["src","test"]`). Not in any lane's file list.
- **`bun check` resolves the whole import graph** — a scoped `bun check src/cli` still reports errors from
  lanes A/B, so read the `file=` lines, not the count.
- **cac removes the matched subcommand from `parsed.args`** — for `aa model glm` the args are `["glm"]`.
  Use `cli.matchedCommandName` (string | undefined) to know which subcommand ran.
- **A repeated option arrives as an array from mri** — `--where a=1 --where b=2` gives `["a=1","b=2"]`;
  a single use is a scalar, so wrap with `asArray` before mapping.
- **cac does not exit on `--help`/`--version`** — it prints and returns; return 0 before loading anything.
  Four keys can appear: `help`, `h`, `version`, `v`; `--` is always present and is internal.
- **A value flag used bare is `true`, and mri coerces numerics** — `--sort` alone threw
  `unknown flag "--h"`-class bugs in mpc, so `assertValues` rejects `true` by name; `int`/`num` reject
  `true` and `""` so `String(true)` never becomes a filter value.
- **Lane C's `applyFilters` returns `{ models, notes }`** — the notes already name an unknown `--where`
  path; merge them into `catalogue.notes` before the envelope and footer, otherwise the note is computed
  and dropped.
- **`renderTable` treats `columns: []` as an exact empty set** — pass `undefined` unless the user named
  columns, or the table renders no columns at all. Trimming only happens when `columns` is undefined.
- **`renderTable` returns `{ text, dropped, hidden }`** — it appends `… N more` and
  `dropped for width: …` itself, so the footer must not repeat either.
- **CSV/MD live in `src/cli/output.ts`** — lane C's `view/format.ts` has number/colour helpers only.
  Values are the display strings; the CSV header uses stable column ids while Markdown uses headers. A new
  column automatically appears in both because both read `COLUMNS` from `view/columns.ts`.
- **`aa fields` must skip nulls** — the record normalizer fills every missing field with `null`, so
  counting null paths reported all 384 models for every path. Count only non-null, non-empty values.
- **`--rows` never trims JSON/CSV/MD** — `rows` is a table cap; `--rows 0` is preserved as `0` and the
  table reads 0 as "all".
- **Colour resolution is per renderer** — `colorEnabled(mode, isTTY, NO_COLOR)`; pass a boolean into
  `renderTable` so plain output stays byte-identical.
- **Keyless coverage is real**: 384 models from `manifest + leaderboard + models`, 42 scored, with no
  `AA_API_KEY`; `indexVersion` is null because only the API carries it in-band.
- **Known defects owned elsewhere (2026-11-20)**: `gpt-6-sol` carries 35 foreign `keys` (polluted join
  keys), its `evals` collapses 216 entries to flat names, and `latency` 275 looks like milliseconds in a
  seconds field. Recorded in `docs/plan/aa-cli/reports/lane-d.md`; not edited here.
- **Package scripts must not be named `fmt` or `check`** — Bun prefers the script over its builtin.
- **Root `scripts/dev-link.ts` does not know `aadev`** — the contract forbids editing it, so the package's
  own `dev:link` (`ln -sfn "$PWD/src/index.ts" ~/.bun/bin/aadev`) is the only linker; wiring `aadev` into
  the root script is a follow-up outside lane D.
