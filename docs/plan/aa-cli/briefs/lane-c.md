# Lane C — filters, sort and the table renderer

Read `docs/plan/aa-cli/contract.md` first. You own `src/filter.ts`, `src/sort.ts`, `src/view/table.ts`,
`src/view/format.ts`, `src/view/help.ts` and `test/view/*`. You type against lane A's `Model` in
`src/model.ts` — if it is not on disk yet, write against the contract exactly and say so in your report.

Everything here is pure: no fetch, no `process.stdout` writes except through the one `renderTable` helper.

## `src/filter.ts`

`applyFilters(models: Model[], query: FilterQuery): Model[]`, where `FilterQuery` carries every filter flag
the contract lists. Rules:

- `--model <re>`: case-insensitive regex over `name`, `slug`, and every entry in `keys`; on an invalid
  pattern fall back to a case-insensitive substring over the same fields, never throw.
- `--creator`: case-insensitive exact match against a comma-separated list (`"openai, anthropic"`).
- `--where <expr>`, repeatable: `path op value` with ops `= != > >= < <= ~`. `path` is a dot-path into the
  record (`intelligenceIndex`, `price.blended`, `release.date`, `reasoning.efforts`); `~` is a
  case-insensitive substring/regex over the resolved value. All `--where` clauses AND together. A path that
  resolves to nothing excludes the row (it cannot satisfy the clause) — and the caller gets a `notes` line
  naming the paths nobody matched, so a typo is visible instead of silently returning zero rows.
- numeric bounds: `--min-intel/--max-intel`, `--min-tps/--max-tps`, `--min-context`; a model with a null
  value fails every numeric bound (null is unknown, not zero).
- `--scored` keeps `intelligenceIndex != null`; `--unscored` keeps the opposite; both is an error.
- `--open-weights` / `--closed-weights`: tri-state with `null` failing both.
- `--since <YYYY-MM-DD>`: `release.date >= since`, and a model with no date fails it.

## `src/sort.ts`

`sortModels(models, field, asc)` over any dot-path, plus named aliases (`intelligence`, `tps`, `context`,
`price`, `released`, `name`). Default is `intelligenceIndex` descending **with nulls always last**, which
must hold for every direction — an unscored model never jumps to the top when `--asc` flips. Tiebreak on
name, then slug, so output is stable across runs.

## `src/view/table.ts` + `format.ts`

- Columns are declared data: id, header, align, gain (how wide it can get), and a `value(model)` returning
  a string. Default set: name, creator, intel, tps, context, price in, price out, released, open. `--columns
  <ids>` picks an exact set; `--columns help` lists them with one-line descriptions (mirror the shape of
  `oc-cmd-compare/src/view/text/help.ts`).
- Trim to `--width` (default terminal width, then 120) by dropping the lowest-priority columns, and print
  a dim `dropped for width: …` line when it does. A column the user named explicitly is never dropped.
- Number formatting: one decimal for scores, thousands separators for context tokens (`200K`, `1.0M`),
  `$0.15` style token prices, `—` for null. Never `-0`, never scientific notation.
- Colour via SGR constants you define locally (green favourable, dim missing, bold headers) and honour
  `--color auto|always|never`, `NO_COLOR`, and non-TTY output. A renderer must produce byte-identical text
  with colour off — prove it with a test.
- `src/view/help.ts`: the legend block explaining each column, and the `--columns help` text.

## Tests

Deterministic, offline, no ANSI assumptions beyond what you emit: filter algebra (each flag alone, two
combined, a null failing a bound), nulls-last in both directions, stable tiebreak, width trimming and its
notice, and colour-off byte equality. Use a small hand-built `Model[]` fixture.

Report to `docs/plan/aa-cli/reports/lane-c.md`, notes in `docs/agents/aa-c.md`.
