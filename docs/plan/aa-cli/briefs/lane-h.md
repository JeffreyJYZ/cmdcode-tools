# Lane H — close the three release blockers

Repo `/Users/jyz/dev/cmdcode-tools`. Three small, unrelated fixes. Nothing else — this lane exists to make the
tree releasable, not to add anything.

## 1. `bun parity` is red

```
bun parity   → --cache / --no-catalog advertised by oduse, missing on cmduse and arkuse
```

Those two flags are **source-forced, not a missing feature**: `oduse` and `ocuse` read a published catalogue
that can be stale, while `cmduse` reads the CommandCode account API plus the local store (nothing to serve
offline) and `arkuse`'s baked `ark.json` is AFP coefficients with no endpoint to refresh from.

Add an `ALLOW` entry to `scripts/check-parity.ts` for exactly those two flags, each with a `reason` string in
the file's own style — the script already fails naming the flag and binary and exits 0 with `SKIP` when a
binary is absent, so read it before editing. A reason must say *why the source forces the difference*, not
"not implemented yet".

## 2. `oc-cmd-compare/src/index.ts` fails `bun fmt --check`

Verified: `cd oc-cmd-compare && bun fmt --check` names that file. It was already modified before the `--pick`
lane started, and that lane correctly left it alone. Run `bun fmt` (write) on it, re-check, and if the diff is
formatting only say so in the report. Do not change its behaviour.

## 3. `aa check` can be repaired by the run that is supposed to diagnose it

Lane G made the cache identity-checked and made `check` reload with `cacheTtlMs: 0`, but the dispatch load in
`aa-models/src/cli/run.ts` still **writes** the cache before `check` looks at it. With the network up, a
poisoned file is repaired before anyone can see it was poisoned, which defeats the diagnostic.

Add a `noCacheWrite` option to the loader options (`aa-models/src/sources/index.ts`), pass it from `run.ts`
on the `check` path only, and keep it honest in `--json` (nothing new in the public envelope). One test: with
`noCacheWrite`, a load against a forged cache file neither serves it nor rewrites it.

## Constraints

- You own `scripts/check-parity.ts`, `oc-cmd-compare/src/index.ts` (format only),
  `aa-models/src/sources/index.ts`, `aa-models/src/cli/run.ts`, `aa-models/src/sources/cache.ts` (only if the
  option belongs there), plus your tests and `docs/plan/aa-cli/reports/lane-h.md`.
- Do not touch `cmduse/**`, other `oc-cmd-compare` files, or any version number. No tag, no publish.
- `rg`/`fd` with explicit paths only; never `grep`/`find`/`sed`. One tree, no worktree.
- Gate: `bun parity` (must PASS or SKIP, quote which), `cargo test` (untouched but prove it),
  `cd aa-models && bun test && bun check && bun fmt --check && bunx biome lint`,
  `cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, wait.
