# Lane M — the fallback store can only degrade, and mpc's old store was never migrated

Repo `/Users/jyz/dev/cmdcode-tools`. Verified on the live machine just now, not from a report:

```
mpc  --json --shape off   DeepSeek V4.1 Flash  tps 160.63
aam  --json --cache 0     deepseek-v4-1-flash-1017  speed 160.63  src "page"
```

The tier work is correct but unreachable, for two reasons:

1. **`~/.cache/mpc/aa-last-good.json` was never migrated.** It still holds the real API payload from
   2026-11-20T10:11:50Z — `intelligence` 169 entries, `tps` 439 entries, `deepseekv41flash: 229.62`. The
   package's own store (`~/.cache/aa-models/last-good.json`) holds a keyless run, so it carries page-tier
   speeds and cannot supply the API tier. A release that stops reading what the previous version wrote is a
   compatibility break; migrate on first load.
2. **The new store records a whole `Catalogue`, not values with their tier**, so any later degraded run can
   overwrite an api-tier figure with a page-tier one. That is the same shape as the empty-write bug: a
   fallback that can only ever go backwards.

## Task

1. Give the stored values their tier. Bump the store schema/revision (the cache already has
   `LOADER_REVISION`; use your own revision for this file) so a stored speed remembers
   `api | page | timescale`. A merge must never replace a higher tier with a lower one, in the store as well
   as in memory. A store without a tier is legacy and must be treated as the tier its numbers actually came
   from — you can tell `229.62` came from the API series, and a page-tier store written by this build says so.
2. Migrate `~/.cache/mpc/aa-last-good.json` on first load when the package's store has no api-tier speeds:
   read it, tag its values `api`, merge with the tier rule, and leave the old file untouched (never delete
   another tool's data). Record the migration in `notes` once so it is visible, not silent.
3. Prove it on the live machine: `aam --json --model deepseek-v4.1-flash` must print `outputSpeed 229.62`
   with `outputSpeedSource "api"`, and `mpc --json --shape off` must print the same, with GLM-5.3 back to
   `72.85` and Tencent Hy4 to `97.57`. Paste all three.
4. Tests: a legacy-shaped store (no tiers) is read and tagged; a page-tier store never overwrites an api-tier
   value; the migration is idempotent (second run changes nothing, no `notes` repeat); a legacy file that is
   absent or malformed is a no-op.

## Constraints

- Own: `aa-models/src/sources/{collect,lastGood,cache,index,speed}.ts`, any new module under
  `aa-models/src/sources/`, their tests, and your two docs paths. Nothing in `cmduse/**`, `core/**` or
  `oc-cmd-compare/**` (the adapter there needs no change if the package reports the right tier).
- Do not delete or rewrite `~/.cache/mpc/aa-last-good.json`. Read only.
- **Do not commit, do not branch.** Leave the work in the tree; the coordinator is holding a PR.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`. One tree, no worktree. No version bump, tag or
  publish, no `AGENTS.md`.
- Gate: `cd aa-models && bun test && bun check && bun fmt --check && bunx biome lint`, plus
  `cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, wait.

Report to `docs/plan/aa-cli/reports/lane-m.md` with the three live numbers and the store schema you chose.
