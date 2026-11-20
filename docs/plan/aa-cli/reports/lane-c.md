# Lane C report — filters, sort and the table renderer

Status: done. All lane-C files written, tested and formatted; both gates that can be scoped to my
files are green.

## Files

| file | lines | what |
| --- | --- | --- |
| `src/filter.ts` | 132 | `FilterQuery`, `applyFilters`, `--model`/`--creator`/bounds/tri-state |
| `src/where.ts` | 111 | dot-path resolver, `--where` parser and comparison (split out to honour the 150-line cap) |
| `src/sort.ts` | 80 | aliases, `sortModels`, nulls-last in both directions, name/slug tiebreak |
| `src/view/columns.ts` | 111 | the column registry as data (`COLUMNS`, `DEFAULT_COLUMNS`, `pickColumns`) — split for the cap |
| `src/view/table.ts` | 105 | `renderTable`, width trimming, row cap, colour |
| `src/view/format.ts` | 91 | number/price/date formatting, SGR, `colorEnabled`, `pad`/`clip` |
| `src/view/help.ts` | 35 | `LEGEND`, `legendText()`, `columnHelp()` (generated from the registry) |
| `test/view/{fixture,filter,sort,table,format}.ts` | 94/134/75/85/84 | 42 tests, offline, hand-built `Model[]` |

`src/model.ts` was absent when I started; lane A landed it mid-run and my files typecheck against the
real interface with no changes.

## What lane D calls

- `applyFilters(models, query): { models, notes }` — **not** a bare `Model[]`. The contract asks the
  caller to receive a note naming a `--where` path nobody publishes, which needs a second return
  value. `src/cli/run.ts` already consumes `.models` / `.notes`.
- `sortModels(models, field?, asc?)` — field is an alias or dot-path; defaults are
  `intelligenceIndex` + descending (`DEFAULT_SORT_FIELD`, `DEFAULT_SORT_ASC`).
- `renderTable(models, { columns?, width?, rows?, color })` → `{ text, dropped, hidden }`. The
  `dropped for width: …` line and the `… N more` row note are already inside `text`.
- `columnHelp()` for `--columns help`; `legendText()` / `LEGEND` for a footer.
- `colorEnabled(mode, isTty, noColor)` for `--color auto|always|never` + `NO_COLOR`.
- `resolvePath(value, path)` from `src/where.ts` — `aa fields` can reuse it.

Column ids: `name slug short creator intel tps latency context max-out price-in price-out blended
released open efforts`. Default set is the nine the contract names. A column with no `drop` priority
(`name`, `intel`, `tps`, `context`, `price-in`, `price-out`, `open`) is never trimmed; an explicit
`--columns` list is never trimmed at all.

## Deviations from the brief

1. `applyFilters` returns `FilterResult` instead of `Model[]` — required by the `notes` clause above.
2. Two extra files, `src/where.ts` and `src/view/columns.ts`, both structurally forced by the
   150-line cap (`filter.ts` was 239, `table.ts` 322 before the split). Neither path is claimed by
   another lane; `src/` at 8 entries is already over the 6-entry rule because of the contract's own
   layout (`model.ts`, `filter.ts`, `sort.ts`, `index.ts`, `cli/`, `sources/`, `view/`).
3. An invalid `--model` pattern drops trailing characters until it compiles (`deepseek(` still finds
   DeepSeek) before falling back to a literal substring. A raw substring of an invalid pattern
   matches nothing, which is the "silently zero rows" failure the brief is trying to avoid.
4. `--since` that is not `YYYY-MM-DD` is reported in `notes` and ignored rather than filtering
   everything out.

## Commands run

```sh
cd aa-models
bun test test/view
# 42 pass, 0 fail, 118 expect() calls (4 files)

bun fmt --check src/filter.ts src/sort.ts src/where.ts src/view test/view
# All 12 files are formatted.

bunx biome lint src/filter.ts src/sort.ts src/where.ts src/view test/view
# Checked 12 files. No fixes applied.

bun check
# 7 errors in 4 files, none of them lane C:
#   src/sources/discover.ts, src/sources/manifest.ts,
#   test/manifest/discover.test.ts, test/manifest/manifest.test.ts
```

Package-wide `bun fmt --check` was still listing other lanes' files at the time of writing
(`src/model.ts`, `src/cli/*`, `src/sources/*`, `test/manifest/*`, fixtures); running `bun fmt` over
the whole tree would have rewritten files I do not own, so I formatted only mine.

## Behaviour worth knowing

- Nulls always sort last, in both directions; ties break on name then slug.
- `--where` excludes a row whose path resolves to nothing, and a path that resolves for no model at
  all gets a `notes` line (`--where price.nope: no model publishes this field`).
- `~` is a case-insensitive regex with a substring fallback; arrays match on any element.
- `fmtPrice` trims trailing zeros (`$0.15`, `$2.5`, `$0`, `$0.075`) and never emits scientific
  notation; `fmtScore` never prints `-0`.
- Colour off is byte-identical to coloured text with its escapes stripped (tested).

## Notes

`docs/agents/aa-c.md`.
