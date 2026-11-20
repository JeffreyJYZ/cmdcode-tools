# Lane G — `aa-models`: cache must never outlive the code that wrote it

Repo `/Users/jyz/dev/cmdcode-tools`, package `aa-models/` (`@jeffreyjyz/aa-models`, bin `aa`).

## The defect, measured just now

Lane A fixed a key-merge bug that had collapsed the catalogue from 534 models / 84 scored to 384 / 42.
The fix is in the code and the live path is correct:

```
aa --cache 0        →  534 of 534 models · from manifest + leaderboard + models
aa check --cache 0  →  manifest 534, leaderboard 200, models 28, coverage 84 / 534
```

But the default run was still wrong, because a cache written **nine minutes earlier by the buggy build**
was served for its full TTL:

```
aa --rows 6         →  … 378 more / 384 of 384 models
note: cache: 384 models, 9m old
aa check            →  manifest     384 models     ← a lie: that is the merged cache, not the source
   ↑ exit path read the cache for a validation command
```

Two defects:

1. The cache payload carries no identity, so a cache written by a different (or broken) build is
   indistinguishable from a good one. Any change to the merge or to a parser silently inherits a stale,
   wrong catalogue for the whole TTL.
2. `aa check` reports cached numbers as per-source counts. A command whose entire purpose is "is the
   source healthy" must never read the cache.

## Task

1. Give the cache file an identity: a schema/loader revision string that you bump by hand whenever the merge
   or a parser changes (comment saying so, right beside the constant), the package version, and
   `fetchedAt`. A cache whose revision or schema does not match is **ignored, not migrated** — refetch and
   overwrite. Keep the "never persist an empty catalogue" rule and keep the `stale`/`notes` labelling.
2. `aa check` bypasses the cache unconditionally, and prints, per source, the count that source actually
   returned. Add one line naming the cache state the default run would use (path, age, revision ok/ignored),
   so a user can see why a default run might differ from `check`.
3. Nothing else may regress: `--refresh`, `--cache 0`, `--cache 15m`, the `stale` flag and the last-good
   fallback all keep working, and `--json` keeps the exact contract envelope (the cache revision is not part
   of the public JSON — put it in `notes` at most).
4. Tests: a cache with the wrong revision is ignored; a matching one is served and reported as such; a
   cache whose `models` is empty is never written and never served; `check` produces source counts even when
   a valid cache exists.

## Constraints

- You own `aa-models/src/sources/index.ts`, `aa-models/src/sources/cache.ts` (new, if you split it),
  `aa-models/src/cli/commands.ts` (the `check` command only), and your tests. Another lane is editing
  `oc-cmd-compare/**` — do not touch it.
- `rg`/`fd` only with explicit paths, never `grep`/`find`/`sed`. One tree, no worktree. No version bump,
  tag or publish. No `AGENTS.md` edits.
- Aim ~100 lines per file, hard cap 150. Gate in `aa-models/`: `bun test`, `bun check`, `bun fmt --check`,
  `bunx biome lint` — foreground, wait for them.

Report to `docs/plan/aa-cli/reports/lane-g.md`: the revision constant you added, where it is bumped, the
before/after of a default run with a poisoned cache present (you can reproduce one by writing a stale file
under the cache dir by hand), and the `aa check` output.
