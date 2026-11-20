# Lane M report — `shell-rc-migrate`

## Version correction

The brief named 0.6.0; the controller corrected this to **0.5.1** before any file was written. Every occurrence uses 0.5.1: `package.json`, `bun.lock`, the backup suffix `.pre-0.5.1.bak`, and this report. The `blocked` schema itself is unchanged, so the command still prints `already on the object schema` for the array form.

## Shipped

- **`opencode-shell-rc/src/migrate.ts`** — new CLI. Exports `BACKUP_SUFFIX`, `parseFlags`, `migrateObject` (pure), `renderMigrated`, and `run(argv): number`. `run` returns the exit code and never calls `process.exit`, so tests drive the real I/O seam; a main-module guard calls `process.exit` for the bin. Has a `#!/usr/bin/env node` shebang, preserved in `dist/migrate.js`.
- **`opencode-shell-rc/package.json`** — version `0.5.1`; `bin: { "shell-rc-migrate": "dist/migrate.js" }`; `cac: ^7.0.0` in **devDependencies** only (no `dependencies` field); build now emits both entries: `bun build src/index.ts src/migrate.ts --outdir dist --target bun --external @opencode/plugin`.
- **`opencode-shell-rc/test/migrate.test.ts`** — 11 hermetic tests, temp `HOME`/`XDG_CONFIG_HOME`, nothing near the real config.
- **`bun.lock`** — refreshed by `bun install`; shell-rc entry now records 0.5.1, the bin and the devDependency. `cac@7.0.0` was already in the lockfile through mpc/reqshape. `bun install` also synced a pre-existing stale line: `oc-cmd-compare` 0.1.14 → 0.1.15, matching its already-bumped `package.json`. No other session's source file was touched.

## Command behaviour

Default target `$XDG_CONFIG_HOME/opencode/shell-rc.json`, falling back to `~/.config/opencode/shell-rc.json`; `--config <path>` overrides. Reuses `configFile()` from `guards.ts`.

- string map → array of `{name, alternative}`, one entry per pair in insertion order; every other key (`env`, unknowns) keeps its position; tab-indented JSON with a trailing newline.
- already an array → `already on the object schema`, exit 0, no write.
- no file → says so, exit 0. No legacy `blocked` map → says so, exit 0, no write.
- malformed JSON → the parser's own message, exit 2, no write.
- `--dry-run` prints the migrated JSON to stdout, writes nothing.
- `--check` exits 1 when a migration is needed, 0 otherwise; no write.
- before the first write, copies the original to `<file>.pre-0.5.1.bak`; an existing backup is left alone with a note, never clobbered.

`migrateObject` applies the same trims and skips as `normalizeBlocked`'s legacy path (non-string/blank values, blank names), so the migrated array normalises to the same entries.

## Compatibility proof

Two tests in the `compatibility with the guard layer` block:

1. a map with valid entries, an invalid name, `cat`, a sentence alternative and a blank value renders byte-identical `renderGuards` output before and after `migrateObject`, with a fixed `installed` fn;
2. a real config file is rendered through `loadConfig()` → `renderGuards()` before migration and after, and the two strings are equal (and do contain the `find`/`grep` functions, so the test cannot pass on two empty scripts).

## Docs

- `opencode-shell-rc/README.md` — new `## Migrating` section: bin name, all three flags, backup name, exit codes, and the "both forms load, so optional but recommended" note.
- `skills/opencode-shell-rc/SKILL.md` — one line under the `blocked` config section pointing at the command.
- `opencode-shell-rc/AGENTS.md` — one bullet added via `agents-bullet-add`: a stored format that gains an object schema ships a converter, not just a parser.

## Gates

`bun test` (92 pass / 0 fail across 6 files, 197 assertions), `bun check` (0 type errors in 14 files), `bun fmt --check` (23 files formatted), `bunx biome lint` (exit 0), `bun run build` (9 modules, `index.js` 14.89 KB + `migrate.js` 28.61 KB) — all green. Biome reports one pre-existing `info` about the `2.6.3` schema URL versus the installed CLI `2.6.7`; it is not an error and predates this lane. The `useTemplate` info introduced by this lane was fixed.

Real-bundle check, against a temp file only: `XDG_CONFIG_HOME=<tmp> node dist/migrate.js --dry-run` printed the migrated JSON; `--check` exited 1; a real run wrote the array and a byte-exact `.pre-0.5.1.bak`. The installed `dist/migrate.js` contains no `import`/`require` of `cac` — bun inlined it (only a `// …/cac/dist/index.js` provenance comment remains), so the published package keeps zero runtime dependencies.

## Not done, by instruction

No `git tag`, no publish, no push, and the tool was never run against the real `~/.config/opencode/shell-rc.json`. Commit and release stay with the controller.
