# Lane M — `mpc`'s published tarball cannot read `core/od.json`

## The defect, measured

Lane K fixed `mpc`'s OpenDesign pricing by reading the repo's single source of truth:

```
oc-cmd-compare/src/data/sources/od/rates.ts:5
import od from "../../../../../core/od.json";
```

That works in the monorepo and breaks the moment the package is installed from npm. Measured just now:

```
$ bun -e '…package.json…'  →  { "bin": { "mpc": "src/index.ts", … }, "files": ["src", "LICENSE"] }
$ cd oc-cmd-compare && bunx npm@latest pack --dry-run | rg -c 'od.json'
(no output — od.json is NOT in the tarball)
```

`files` ships only `src`, and the import reaches five levels above it. An installed `mpc` therefore fails to resolve the module at startup — not on the OpenDesign path, on **every** path, because it is a static top-level import. This is a release blocker for `mpc-v0.1.14`, and it is exactly the class of trap the repo already recorded once: `include_str!` reaching outside a crate is "fine locally and fatal at `cargo publish`" (see the comment at `cmduse/src/oduse/od.rs:20`).

## The two shapes, and how to choose

**A. Copy the data into the package at publish time.** Add a step that writes `core/od.json` into a path inside `oc-cmd-compare` (e.g. `src/data/sources/od/od.generated.json`) before packing, and import that. Pros: no build-time codegen of logic, the data stays one authored file. Cons: a committed or generated copy of a 46-row table is a second copy that can drift — unless the step is wired into `prepack`, and a test asserts the copy is byte-identical to `core/od.json`.

**B. Generate a TypeScript module from `core/od.json`.** A small script (like the repo's existing `scripts/extract-*.ts` pattern) emits `src/data/sources/od/od.generated.ts` with the rows as a typed constant, and a test re-runs the generator and asserts the committed output matches. Pros: same shape as the repo's existing generated-file convention (`catalog.ts`, `gating.json` are both generated and pinned by a test); no JSON-resolution dependency. Cons: one more generated file.

**Pick one and write down why in your report.** Prefer the one that cannot silently drift: in both cases the required proof is a test that fails when `core/od.json` and the packaged copy disagree. A `prepack` script alone is not proof — nothing runs it in a test.

Whatever you choose, the invariant is: **`bun test` in `oc-cmd-compare` must fail if the packaged rates no longer match `core/od.json`**, and `bunx npm@latest pack --dry-run` must list the file that carries them.

## What to build

1. **The packaged-data path**, per shape A or B above.
2. **The drift test** — regenerate/compare and assert equality on `input`, `output`, `cacheRead`, `cacheWrite`, `longContext` and `rateSource` for all 46 rows, not just a count. A count comparison passes when someone edits one rate.
3. **`package.json`** — whatever `files`/`scripts` entry the chosen shape needs, and nothing more. If you add a `prepack`, keep it non-interactive (never `npm publish`, never `npm login`).
4. **Prove the install works.** Build the tarball locally and run the installed binary against it:
   ```sh
   cd oc-cmd-compare && bunx npm@latest pack --dry-run   # must list the file
   ```
   and, stronger, pack for real into a temp dir, extract it, and run `bun <tmp>/package/src/index.ts --od-plan go --json --shape off --model 'DeepSeek V4.1 Flash'` from **outside** the repo so nothing resolves through the monorepo. Paste the output — that is the only evidence that the published package works.
5. **Update `oc-cmd-compare/README.md`** if it documents the install/run path, and any comment in `rates.ts` that still claims a relative path into `core/`.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything to a registry. A local `npm pack --dry-run` (and a real pack into a temp dir) is fine; `npm publish` is forbidden.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `oc-cmd-compare/**` and, if the generator lives centrally, a new script under `scripts/`. **Do not touch** `core/od.json` (read-only source of truth), `cmduse/**`, or `opencode-plugin/**` — sibling lanes own those.
- Prefer the system temp dir the harness approves for throwaway extraction: `/private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode`. Never keep anything you need in `/tmp`.
- Gate before you report: `cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint`, plus both `pack` proofs. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-m-mpc-packaged-rates.md`. Final chat reply under 15 lines: which shape you chose and why, the pack proof, the drift test's name, the gate result.
