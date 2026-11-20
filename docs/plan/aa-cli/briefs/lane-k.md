# Lane K — `mpc` consumes `@jeffreyjyz/aa-models` instead of its own AA scrapers

Repo `/Users/jyz/dev/cmdcode-tools`. `@jeffreyjyz/aa-models@0.1.0` is published and resolvable. `mpc`
(`oc-cmd-compare/`) still carries a private copy of the same Artificial Analysis scrapers, which is the
duplication the package was extracted to remove: two implementations of one source drift, and the copy in
`mpc` is the older one.

## Part 1 — give the package a library entry (version 0.1.1)

Today `aa-models`' only entry is the CLI (`src/index.ts`), so nothing can import it. Add:

- `aa-models/src/lib.ts` — re-export the public API and nothing else: `loadCatalogue`, and the types
  `Model`, `Catalogue`, `LoadOptions` from `src/sources/index.ts` and `src/model.ts`. No CLI code, no
  `process.argv`, no side effects on import.
- `package.json`: an `exports` map — `"."` → `./src/lib.ts`, `"./package.json"` → `./package.json`. Keep
  `bin` as is, keep `files: ["src", "LICENSE"]`. Bump `version` to `0.1.1`.
- One test that imports through the public path and calls `loadCatalogue` against a stubbed fetch, proving
  the entry works without pulling in the CLI.
- README: a short `## Use as a library` section with the import and a three-line example.

Do not tag or publish. The owner will.

## Part 2 — `mpc` off its private copy

Currently: `oc-cmd-compare/src/data/sources/aa/{api,flight,lastGood,leaderboard,parse,web}.ts`, used from
`src/data/bench/{index,resolve}.ts` through a `BenchData` shape (`intelligence: Map<string, number>`,
`tps: Map<string, number>`, optional `indexVersion`).

- Add `"@jeffreyjyz/aa-models": "^0.1.1"` to `oc-cmd-compare/package.json` dependencies. In the monorepo it
  resolves to the workspace copy; from npm it resolves to the published one. Verify both would work (the
  published tarball ships `src/**`, which is what the workspace copy has).
- Delete the six `aa/` source files and replace them with one adapter module, e.g.
  `src/data/sources/aa.ts`, that calls `loadCatalogue()` and maps each `Model` into the `BenchData` maps for
  **every** entry in `model.keys` (that is what the package exposes instead of `aaKeyVariants`). Keep the
  "best value wins, never let a lower score overwrite a higher one" rule, keep a null score out of the maps,
  and pass the API key through when `--bench aa` names the API path.
- Preserve the two named schemes exactly: `--bench aa` means keyed (API when `--aa-key`/`AA_API_KEY` is
  present), `aa-web` means keyless. `--no-fallback`, `--no-ability`, `--check` and the footer's
  `ability <source> (N models, M speed)` line all keep working — the counts may legitimately grow, because
  the package's manifest source covers more models than the old page scrape; say so in the report with the
  before/after counts.
- `src/keys.ts` keeps `normalizeKey` (used for row keys) but loses `aaKeyVariants` if nothing else needs it;
  check with `rg` before deleting.
- Delete the AA parser fixtures/tests that now live in the package (`test/data/*aa*`, `test/unit/*aa*`), but
  keep and extend a test for the new adapter: a small `Catalogue` in, expected `intelligence`/`tps` maps out,
  including a null score and a model with two keys.

## Acceptance

- `mpc --json --shape off` keeps its contract: same top-level keys, `rows[].{key,name,oc,cc}` unchanged. Diff
  the key sets against the previous output (you can capture it from `git stash`-free HEAD first) and paste
  the diff in the report — it must be empty apart from ability/tps **values** where coverage improved.
- For three models (`DeepSeek V4.1 Flash`, `GLM-5.3`, `Tencent Hy4`) print ability/tps before and after.
- `mpc --check` still reports source counts and unmatched keys.
- Gate: `cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint`; `cd aa-models &&
  bun test && bun check && bun fmt --check && bunx biome lint`; root `bun install` (lockfile must update —
  commit it) and `bun parity`. Foreground, wait.

## Constraints

- You own `aa-models/src/lib.ts`, `aa-models/package.json`, `aa-models/README.md`, one new test under
  `aa-models/test/`, and everything under `oc-cmd-compare/src/data/`, `oc-cmd-compare/package.json`,
  `oc-cmd-compare/test/` plus `bun.lock`. Nothing under `cmduse/**` or `core/**`.
- No tag, no publish, no `AGENTS.md`. `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`. One tree, no
  worktree. No version bump for `mpc` itself — the owner releases.

Report to `docs/plan/aa-cli/reports/lane-k.md`, notes in `docs/agents/aa-k.md`.
