# Lane D — CLI, package, README, workspace wiring

Read `docs/plan/aa-cli/contract.md` first. You own `aa-models/src/index.ts`, `aa-models/src/cli/*`,
`aa-models/package.json`, `aa-models/README.md`, `aa-models/LICENSE`, the root `package.json` workspaces
entry, and `aa-models/biome.json` if one is needed.

Lanes A, B and C are writing `src/model.ts`, `src/sources/**`, `src/filter.ts`, `src/sort.ts` and
`src/view/**` at the same time. Write against the contract; if a module is missing when you typecheck,
record it and keep going — flag it in your report instead of writing that file yourself.

## Package

Create `aa-models/` to the shape of the contract (copy `reqshape/package.json`'s structure): name
`@jeffreyjyz/aa-models`, version `0.1.0`, bins `aa` and `aadev` both pointing at `src/index.ts`, `imports`
`#~/*`, `files: ["src", "LICENSE"]`, `publishConfig.access: "public"`, deps `cac` only, dev deps
`@biomejs/biome ^2.5.13`, `@types/bun latest`, `typescript ^7`, and `scripts`: `start`, `test`, `lint`,
`typecheck`, `dev:link` (link `aadev`, same one-liner as the siblings). `repository.directory` is
`aa-models`. Copy the MIT licence text from `reqshape/LICENSE` — the holder line stays the project's.

Add `"aa-models"` to the root `package.json` `workspaces` array, in a sensible position, and nothing else.

## CLI

- `src/index.ts`: thin entry, `process.exitCode = await run(process.argv.slice(2))`, errors printed as
  `aa: <message>` and exit 1.
- `src/cli/parse.ts`: `cac` declarations for every flag in the contract, and the two subcommands
  (`model`, `fields`, `check`). Follow `oc-cmd-compare/src/cli/parse/cac.ts` for the traps: cac does not
  exit on `--help`/`--version`, so return 0 before doing any work; a value-taking flag used bare arrives as
  boolean `true` and must be rejected by name rather than stringified.
- `src/cli/options.ts` + `src/cli/map.ts`: parsed bag → a typed `Options`, duration parsing for `--cache`
  (`0`, `30s`, `15m`, `6h`, `1d`; reject anything else with the accepted forms listed), and validation
  (unknown flags throw; mutually exclusive pairs like `--scored`/`--unscored` throw).
- `src/cli/run.ts`: `loadCatalogue` → `applyFilters` → `sortModels` → one of `renderTable` / JSON / CSV /
  Markdown, then a footer line naming the sources, the index version, the counts and any `notes` (stale
  cache, dead source, unknown `--where` path). `--json` prints exactly the contract object and nothing else
  on stdout — no banner, no footer.
- `aa model <query>`: resolve by exact slug, then exact key, then the filter; more than one match lists the
  candidates and exits 1 with a message naming them. One match prints the full record as labelled fields in
  table mode, or the record alone under `--json`.
- `aa fields`: enumerate every dot-path present across the loaded catalogue with a count of models carrying
  it; useful to discover what AA actually publishes without trusting a hardcoded list.
- `aa check`: call each source, print one line per source with its count or its failure, then the index
  version and the coverage (scored / total). Exit 1 when no source produced a model.

## README

Canonical docs page for the package, same skeleton as the sibling READMEs: `# Title` → one-sentence tagline
→ shields badge line (`?style=flat-square`) → `## What it is` → `## Install` → `## Usage` → `## Commands` →
`## JSON output` → `## Links`. Every fence language-tagged. No hardcoded version in prose. Document the
`--json` schema block verbatim from the contract, list every flag with one line each, and say plainly where
the key comes from (`AA_API_KEY`) and what the keyless path loses.

## Tests

`test/cli/`: parse tests that never touch the network (inject a loader stub): unknown flag throws, bare
value flag throws with its name, `--cache 15m` parses to ms and `--cache soon` rejects, `--scored --unscored`
throws, `--json` output is the contract object (assert the key set), and `--rows 0` means all rows. Keep
each file under the 150-line cap.

## Proof

`bun install` at the repo root (it will pick up the new workspace member), then in `aa-models/`:
`bun test`, `bun check`, `bun fmt --check`, `bunx biome lint`, and one live run each of `aa --rows 5`,
`aa --json --rows 3`, `aa fields | head`, `aa check`. Quote the real output — if a lane's module is still
missing, say which and paste the error rather than pretending the run passed.

Report to `docs/plan/aa-cli/reports/lane-d.md`, notes in `docs/agents/aa-d.md`.
