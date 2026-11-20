# aa-models — lane C notes

Facts worth keeping; the report is `docs/plan/aa-cli/reports/lane-c.md`.

- **`src/model.ts` existed only mid-run.** Lane A landed it while lane C was writing; the type-only
  imports meant nothing had to change, because Bun erases `import type` and `#~/model.ts` never had to
  resolve for tests to run. A missing peer file is not a reason to block — write to the contract and
  re-check once it appears.
- **`bun check` is package-wide and cannot be scoped.** With other lanes mid-flight it prints their
  errors; read the per-file summary at the end rather than the count, and confirm none of the named
  files are yours.
- **`bun fmt` accepts paths** (`bun fmt src/x.ts test/y`), so a lane can format its own files without
  rewriting the other lanes' unformatted ones. `bun fmt --check <paths>` scopes the gate the same way.
- **Biome's recommended lint runs clean on `.sed`-free arrow-table code** — the only trap hit was the
  control-char regex for stripping SGR in tests (Biome forbids `\x1b` in a regex literal); walk the
  string and skip to the terminating `m` instead.
- **Bun's `toFixed` rounding is binary**: `(120.55).toFixed(1)` is `"120.5"`. Assert formatter output with
  a value that is unambiguous in binary (120.56), or the test pins the float's error, not the formatter.
- **`--where` typo detection belongs before filtering**: check path resolution across the input list, so
  the note appears even when another clause already excluded everything.
- **An invalid `--model` regex needs a useful fallback.** Literal substring of `deepseek(` matches
  nothing; trimming trailing characters until the pattern compiles keeps the intent.
