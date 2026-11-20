# Lane J — `aa` → `aam`, plus the `--version` proof

Renamed the binary and dev twin from `aa`/`aadev` to `aam`/`aamdev` so the package can never shadow
macOS `/usr/bin/aa` (Apple Archive). Package name, directory, `aa-models/1` schema and `AaTest`-style
internals are unchanged, as the brief required.

## What changed

| file | change |
| ---- | ------ |
| `aa-models/package.json` | `bin` keys `aa`/`aadev` → `aam`/`aamdev`; `dev:link` links `$HOME/.bun/bin/aamdev` |
| `aa-models/src/index.ts` | top-level error prefix `aa:` → `aam:` |
| `aa-models/src/cli/parse.ts` | `cac("aam")`, parse argv `["node","aam",…]`, three `cli.example("aam …")` |
| `aa-models/src/cli/check.ts` | two `aam:` error prefixes, doc comment |
| `aa-models/src/cli/commands.ts` | two `aam:` error prefixes, two doc comments |
| `aa-models/src/cli/map.ts` | thrown message `aam model expects a slug, key or name` |
| `aa-models/src/cli/options.ts`, `output.ts` | doc comments naming `aam model` |
| `aa-models/src/sources/{index,cache,api,leaderboard}.ts` | doc comments naming `aam check` |
| `aa-models/test/cli/{commands,check,run}.test.ts` | describe labels `aam model` / `aam fields` / `aam check` |
| `aa-models/README.md` | every invocation, the Usage block, the `## Commands` table, `aadev` → `aamdev`; `bun fmt` re-aligned the two code blocks |
| `scripts/dev-link.ts` | `DEV_COMMANDS` entry `aamdev`, both header comments |

`.github/workflows/npm-plugin.yml` was **not touched**: its tag table names packages, not bins, so no line
listed the binary. Nothing to parse.

## `--version`

Already wired in `src/cli/parse.ts` (`import pkg from "../../package.json"` + `cli.version(pkg.version)`),
and `run()` returns 0 when `parsed.version` is set — the brief's "prints usage and exits" was stale.
Nothing was needed; verified below, and it now prints the renamed prefix.

## Proof

```
$ bun run src/index.ts --version
aam/0.1.0 darwin-arm64 bun-v26.3.0
EXIT=0
```

```
$ bun run src/index.ts --help
aam/0.1.0

Usage:
  $ aam <command> [options]

Commands:
  model <query>  one model's full record
  fields         every field present, with coverage counts
  check          validate each source

For more info, run any command with the `--help` flag:
  $ aam model --help
  $ aam fields --help
  $ aam check --help

Options:
  --model <re>       name/slug/creator regex (or substring when invalid)
  … (unchanged flag list) …
  -h, --help         Display this message
  -v, --version      Display version number

Examples:
aam --rows 10 --sort tps
aam model deepseek-v4.1-flash --json
aam --where price.blended\<1 --open-weights
EXIT=0
```

Subcommands, run against the live cache:

```
$ bun run src/index.ts --columns help      → column legend, exit 0
$ bun run src/index.ts fields              → 246 fields across 534 models · manifest + leaderboard + models, exit 0
$ bun run src/index.ts check               → manifest 534 / leaderboard 200 / models 28, coverage 84, cache line, exit 0
$ bun run src/index.ts model glm-5.3       → aam: "glm-5.3" matches 2 models — narrow it: (…), exit 1
$ bun run src/index.ts --rows 3            → 534 of 534 models · from manifest + leaderboard + models, exit 0
```

The `model` case is the renamed error prefix behaving as before (ambiguous query).

```
$ rg -n 'aadev|Usage: aa|\baa (--|fields|check|model)' aa-models
(no matches, rc=1)

$ rg -n 'aadev' aa-models scripts .github
(no matches, rc=1)
```

## Gate in `aa-models/` (foreground, waited)

| command | result |
| ------- | ------ |
| `bun test` | 117 pass, 0 fail, 335 expect() calls, 15 files |
| `bun check` | ✓ No type errors in 44 files |
| `bun fmt --check` | All 53 files are formatted |
| `bunx biome lint` | Checked 52 files, no fixes, `Found 1 info` (config says biome 2.5.15, binary 2.6.7 — pre-existing `biome migrate` notice, no errors, exit 0) |

No version bump, no tag, no publish, no `AGENTS.md`. Nothing under `cmduse/**` or `oc-cmd-compare/**`
was touched; `git status` shows only the files in the table above plus this report.
