# Lane J — the `aa` binary name collides with a macOS system tool

`aa-models/package.json` declares bins `aa` and `aadev`. On macOS there is a stock `/usr/bin/aa`
(Apple Archive, `Mach-O universal binary`), so installing the package would shadow an OS tool — user PATHs
put `~/.bun/bin` before `/usr/bin`, so it *would* win, and anything calling Apple's `aa` would break. Today
`command -v aa` resolves to `/usr/bin/aa`, which is how this was caught.

Nothing is published to npm yet, so the rename is free. Do it now.

## Rename

- bins: `aam` (primary) and `aamdev` (dev twin), both still `src/index.ts`. Package name stays
  `@jeffreyjyz/aa-models`.
- Every user-visible string: `--help` usage line, error prefix (`aam: <message>`), `aam fields`,
  `aam check`, `aam model`, the footer's hint lines, README (install, usage, every command example, the
  `## Commands` table), and any test that asserts on the usage or error text.
- `scripts/dev-link.ts` at the repo root: the entry must link `aamdev`, not `aadev`.
- `.github/workflows/npm-plugin.yml`: the comment block naming each package's bins, if it lists them.
- `aa-models/package.json`'s `dev:link` script and `scripts.start` if they name the binary.

Do **not** rename the directory, the package, the `AaTest`-style internal names, or anything that is not a
binary invocation.

## Also add `--version`

The CLI has no `--version`, so `aam --version` prints usage and exits. `cac` provides it from
`package.json` the way `oc-cmd-compare` does (`cli.version(pkg.version)`); wire it the same way and make
`aam --version` print the version and exit 0.

## Proof

- `bun run src/index.ts --version` and `--help` (paste both, and confirm the other subcommands still work).
- `rg -n 'aadev|Usage: aa|\baa (--|fields|check|model)' aa-models` must return nothing after the change.
- Gate in `aa-models/`: `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint` — foreground, wait.
- YAML parse `.github/workflows/npm-plugin.yml` again if you touch it, and say which parser.

## Constraints

Files you own: everything under `aa-models/`, `scripts/dev-link.ts`, `.github/workflows/npm-plugin.yml`,
and `docs/plan/aa-cli/reports/lane-j.md`. No version bump, no tag, no publish, no `AGENTS.md`.
`rg`/`fd` with explicit paths only; never `grep`/`find`/`sed`. One tree, no worktree. Nothing in
`cmduse/**` or `oc-cmd-compare/**`.
