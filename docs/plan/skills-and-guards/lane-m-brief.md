# Brief — lane M: a migration script for `blocked`

Repo: `~/dev/cmdcode-tools`. Read the root `AGENTS.md`, `opencode-shell-rc/AGENTS.md`, and
`docs/plan/skills-and-guards/schema.md`.

0.5.0 parses both forms but nothing converts an old file, so every user stays on the legacy map
forever. Ship the converter in the package itself.

## The command

A `bin` entry, `shell-rc-migrate`, source `src/migrate.ts`, built into `dist/` like the plugin.

- Default target: `$XDG_CONFIG_HOME/opencode/shell-rc.json`, falling back to
  `~/.config/opencode/shell-rc.json`; `--config <path>` overrides.
- `blocked` as a string map → array of `{ name, alternative }`, one entry per pair, original order.
- Preserve every other key (`env`, anything unknown) and the file's tab indentation; write a
  trailing newline.
- Already an array → print `already on the object schema`, exit 0, write nothing.
- No config file → say so, exit 0.
- Malformed JSON → print the parser's message, exit 2, write nothing.
- `--dry-run` prints the migrated JSON and writes nothing.
- `--check` exits 1 when a migration is needed and 0 when it is not, for CI.
- Before overwriting, copy the original to `<file>.pre-0.5.1.bak`; if that backup exists, leave it
  alone and say so rather than clobbering the first copy.

The package's rule is **no runtime dependencies**. Bundle `cac` (devDependency) into `dist/` with
the existing bun build, as the repo's CLI convention requires `cac` for argument parsing.

## Compatibility

The migrated output must load through the same `normalizeBlocked` path and render byte-identical
guards to the legacy input. Prove that in a test: same entries, legacy map and migrated array, equal
`renderGuards` output.

## Tests

Temp `HOME`/`XDG_CONFIG_HOME` for every case: map → array, already-array, missing file, missing
`blocked` key, malformed JSON, `--dry-run`, `--check` both exits, backup created once, `env`
preserved, order preserved. Nothing touches the real config.

## Docs

- `opencode-shell-rc/README.md`: a "Migrating" section, the bin name, the flags, and the note that
  both forms work so migrating is optional but recommended.
- `skills/opencode-shell-rc/SKILL.md`: one line under config pointing at the command.
- `opencode-shell-rc/AGENTS.md`: one bullet — a stored format that gains an object schema ships a
  converter, not just a parser.

Bump the package to **0.5.1**. Do not tag, publish, push, or run the tool against the real config —
the controller does that after the release. Gates: `bun test`, `bun check`, `bun fmt --check`,
`bunx biome lint`, `bun run build`, plus a real `node dist/migrate.js --dry-run` against a temp file.

Report to `docs/plan/skills-and-guards/lane-m.md`.
