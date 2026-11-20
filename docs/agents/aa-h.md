# Lane H notes — release blockers

Measured facts and traps from the lane that cleared `bun parity`, the `oc-cmd-compare` formatting red and the
`aa check` self-repair. Recorded here, not in `AGENTS.md`.

## `bun parity` allow-list

- The check fails on **any** flag one binary advertises and another does not: `--cache: undeclared difference —
  missing on cmduse, arkuse`. Every difference needs an `ALLOW` entry keyed by exactly the binaries that carry
  the flag; the set must match in both directions, so a stale entry fails as loudly as a missing one.
- `--cache` and `--no-catalog` are carried by `ocuse` and `oduse` only. `ocuse` strips both in
  `cmduse/src/ocuse/cli.rs::prepare`, `oduse` in `cmduse/src/oduse/args.rs::split_catalog_flags` — both before
  the shared `cli.rs` parser, which is why they never appear on `cmduse`'s own help.
- The script resolves `$<BIN>_BIN`, then `target/debug/<bin>dev`, then `<bin>dev` on `PATH`, then `<bin>`; with
  no binary it exits 0 with `SKIP`. All four `dev` twins exist here, so a red parity run is always a real
  difference, never a missing build.

## `oc-cmd-compare/src/index.ts` was formatting-only

- `bun fmt --check` named the file; `bun fmt` collapsed a multi-line `console.error(...)` call into one line.
  After the write the file was **byte-identical to `HEAD`** (`git diff --quiet` passes), so the pre-existing
  "modification" was a line-wrap that never belonged in a commit and no behaviour was involved.
- Worth knowing before attributing a red `fmt --check` to the current lane: a formatting-only diff can look
  like real in-flight work in `git status`.

## `noCacheWrite`

- `loadCatalogue` writes **two** stores, not one: `last-good.json` (always, on any non-empty result) and
  `catalogue.json` (only when `cacheTtlMs > 0`). Suppressing only `writeCache` would still let `aa check`
  clobber the failure fallback, so `noCacheWrite` gates both.
- The option deliberately does **not** change reads: `cacheTtlMs` stays the read control, and a `check`
  dispatch load may still serve a valid cache — `runCheck` ignores that catalogue and reloads with
  `cacheTtlMs: 0`, so the served copy only saves the network round trip.
- Removing the dispatch write is what makes the diagnostic honest. Same forged file (identity `revision 0`),
  network up:

  ```
  before: cache: …/catalogue.json · just now old · revision 1 · served   (file rewritten)
  after:  cache: …/catalogue.json · 44m old · revision 0 (current 1) · ignored
  ```

- `runCheck`'s own reload (`cacheTtlMs: 0`) still writes `last-good.json` — `cli/check.ts` belongs to lane G
  and was out of this lane's scope, so a `check` run still refreshes the fallback. Nothing reports on
  `last-good`, so it cannot lie about the cache, but the one-line fix is `noCacheWrite: true` beside that
  `cacheTtlMs: 0`.

## Contract caps decide where a test lives

- `docs/plan/aa-cli/contract.md`: **150 lines per file, 6 entries per directory**, tests included. A 17-line
  test cannot join `test/sources/catalogue.test.ts` (146 lines) and `test/sources` already holds six entries,
  so the test went to `test/cli/run.test.ts` — `test/cli` had exactly one slot. Check both caps before adding
  anything, or the file lands over and splits somebody else's work to pay for it.
- A run-level test is also the stronger one here: `run(["check"])` exercises the `run.ts` wiring, not just the
  loader option, so an unwired flag fails the test.
