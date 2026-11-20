# Lane H — the three release blockers

Repo `/Users/jyz/dev/cmdcode-tools`. Three unrelated fixes, nothing added. All gates green at the bottom.

## 1. `bun parity` — two source-forced flags allow-listed

`--cache` and `--no-catalog` are carried by `ocuse` and `oduse` only. Both strip them before the shared
`cli.rs` parser — `cmduse/src/ocuse/cli.rs::prepare` and `cmduse/src/oduse/args.rs::split_catalog_flags` — so
neither `cmduse`'s nor `arkuse`'s help ever shows them. Each now has its own `ALLOW` entry in
`scripts/check-parity.ts`, with the reason naming what the source forces rather than "not implemented":

```ts
{
	flag: "--cache",
	binaries: ["ocuse", "oduse"],
	reason: "Both price turns from a model catalogue fetched live and held on disk, so --cache picks that
	         file's TTL (0 disables it). cmduse's prices arrive with the account API's usage and arkuse's
	         ark.json is baked AFP coefficients with no endpoint to refetch, so neither binary has a file to
	         expire.",
},
{
	flag: "--no-catalog",
	binaries: ["ocuse", "oduse"],
	reason: "Both fall back to the catalogue baked into the binary, so --no-catalog skips the live fetch and
	         its cache entirely. cmduse has no baked price table and arkuse's baked ark.json is its only
	         source, which makes the flag meaningless on either.",
},
```

(Wrapped here for reading; each is one line in the file, matching its neighbours.)

Before / after of the exact failure and its fix:

```
before: FAIL parity check: 2 difference(s)
          - --cache: undeclared difference — missing on cmduse, arkuse
          - --no-catalog: undeclared difference — missing on cmduse, arkuse
after:  PASS parity check: 4 binaries, 30 flags, 13 allowed differences
```

All four `dev` twins resolved from `target/debug`, so that PASS is a real comparison, not the SKIP path.

## 2. `oc-cmd-compare/src/index.ts` — formatting only, and it is now HEAD

`bun fmt` collapsed one multi-line call:

```diff
-	console.error(
-		`mpc: ${error instanceof Error ? error.message : String(error)}`,
-	);
+	console.error(`mpc: ${error instanceof Error ? error.message : String(error)}`);
```

No statement changed, no argument order changed, no behaviour touched. The consequence is worth recording:
`HEAD` already carries the one-line form, so after the write `git diff --quiet oc-cmd-compare/src/index.ts`
passes — **the file is byte-identical to `HEAD`** and the earlier "modification" in `git status` was a
line-wrap nothing depended on. `bun fmt --check` now reports `All 126 files are formatted`.

## 3. `aa check` no longer repairs the cache it diagnoses

`aa-models/src/sources/index.ts` gained `LoadOptions.noCacheWrite?: boolean`. `loadCatalogue` writes two stores —
`last-good.json` on every non-empty result, `catalogue.json` when `cacheTtlMs > 0` — so the option gates
**both**. It does not touch reads: `cacheTtlMs` stays the read control, and `check`'s dispatch may still serve
a valid cache because `runCheck` discards that catalogue and reloads cache-less.

`aa-models/src/cli/run.ts` sets it on the check path only:

```ts
// `check` reloads with its own cache-less load and then reports the file a
// default run would read, so this dispatch must not rewrite it first: a
// poisoned cache has to still be poisoned when the command describes it.
noCacheWrite: options.command === "check",
```

Measured with a forged file (`schema aa-models/2`, `revision 0`, one model) under `AA_CACHE_DIR=<temp>`,
network up, same command either way:

```
before: cache: …/catalogue.json · just now old · revision 1 · served
        ...and the file was rewritten to revision 1 (the diagnostic defeated)

after:  cache: …/catalogue.json · 44m old · revision 0 (current 1) · ignored
        file byte-identical to what was there before the run
```

`check --json` is unchanged — `schema`, `sources[{name,count}]`, `indexVersion`, `fetchedAt`, `stale`,
`notes`, `total`, `scored`, `ok`; the cache line still rides inside `notes`, and no key was added.

### The test

`aa-models/test/cli/run.test.ts` (new, 59 lines) — `run(["check"])` against a forged cache file asserts the
line reads `revision 0 (current 1) · ignored`, the forged slug never appears in the output, and
`readFileSync(cachePath())` still equals the forged bytes. It drives `run.ts`, so an unwired option fails
too. Proven to bite: with the guard forced back to `persist = true` it fails exactly as the old build did —

```
Expected to contain: "revision 0 (current 1) · ignored"
Received: "…cache: …/catalogue.json · just now old · revision 1 · served…"
```

It lives in `test/cli` because the contract caps both budgets: `test/sources/catalogue.test.ts` is 146 lines
against a 150 line cap, `test/sources` already holds six directory entries, and `test/cli` had one slot left.

## Gates (all foreground, all waited for)

```
bun parity                        → PASS parity check: 4 binaries, 30 flags, 13 allowed differences
cargo test                        → 359 passed + 22 passed, 0 failed
cd aa-models     bun test         → 116 pass, 0 fail, 332 expect() calls, 15 files
                 bun check        → ✓ No type errors in 44 files
                 bun fmt --check  → All 53 files are formatted
                 bunx biome lint  → exit 0 (one pre-existing info: config schema 2.6.7 migrate notice)
cd oc-cmd-compare bun test        → 186 pass, 0 fail, 586 expect() calls, 30 files
                 bun check        → ✓ No type errors in 118 files
                 bun fmt --check  → All 126 files are formatted
                 bunx biome lint  → exit 0 (one pre-existing info: config schema 2.6.3 migrate notice)
```

File sizes against the 150 line cap: `sources/index.ts` 139, `cli/run.ts` 83, `test/cli/run.test.ts` 59,
`test/sources/catalogue.test.ts` 146 (unchanged), `scripts/check-parity.ts` 247 (a script, outside the package
cap and already over it).

## Files touched

- `scripts/check-parity.ts` — two `ALLOW` entries (`--cache`, `--no-catalog`), reasons only.
- `oc-cmd-compare/src/index.ts` — `bun fmt` only; now identical to `HEAD`.
- `aa-models/src/sources/index.ts` — `noCacheWrite` on `LoadOptions`; both writes gated on it.
- `aa-models/src/cli/run.ts` — passes it on the `check` path.
- `aa-models/test/cli/run.test.ts` — new, one test.
- `docs/agents/aa-h.md`, this report.

Nothing in `cmduse/**`, no other `oc-cmd-compare` file, no version number, no tag, no publish.

## One wart left, for whoever owns `aa-models/src/cli/check.ts`

`runCheck`'s own reload (`cacheTtlMs: 0`) still writes `last-good.json`, because that file is lane G's and
outside this lane's scope. Nothing reports on `last-good`, so it cannot mislead the diagnostic; the fix, if
wanted, is `noCacheWrite: true` beside that `cacheTtlMs: 0`.

## Follow-up: the wart above is closed (2026-11-20)

`aa-models/src/cli/check.ts` — `runCheck`'s reload now passes `noCacheWrite: true` beside `cacheTtlMs: 0`,
and the doc comment says both stores stay unwritable. No `last-good` write exists elsewhere on the check
path (`inspectCache` and `readLastGood` only read), so nothing else needed gating; the `--json` envelope is
untouched and the cache line still rides in `notes`.

Proven by a second test in `aa-models/test/cli/run.test.ts` (81 lines): a forged `last-good.json` under
`AA_CACHE_DIR` is byte-identical after `run(["check"])`. With the option forced to `false` it fails exactly
as before the fix — the file came back `6617 bytes` of freshly fetched models instead of the forged 65. Gates
in `aa-models/`: `bun test` 117 pass / 0 fail, `bun check` clean, `bun fmt --check` all 53 formatted,
`bunx biome lint` exit 0 (the pre-existing 2.6.7 schema-migrate info only).
