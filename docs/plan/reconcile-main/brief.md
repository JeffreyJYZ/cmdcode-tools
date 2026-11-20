# Brief — reconcile the released 0.5.39 line with main

Repo: `~/dev/cmdcode-tools`. Read the root `AGENTS.md` first, and `opencode-plugin/AGENTS.md` if it exists.

## Situation

Local `main` is 13 commits ahead of `origin/main`, all dated 2026-11-18, all by the owner. Their
code was cut as tags `plugin-v0.5.38`, `plugin-v0.5.39` and `mpc-v0.1.14` and published, but the
branch itself was never merged, so `origin/main` still carries `opencode-plugin@0.5.36` from the
squash PR #37.

The commits are real, unreleased-on-main work and must land, not be dropped:

```
2674838 feat(mpc): read every OpenDesign-adjacent ability source, not just the top-N chart
cfab9af docs(opendesign): record lane O, P and U briefs and the 0.5.39 release proof
0a73a58 chore(opencode-plugin): bump version to 0.5.39
fe00a06 fix(opencode-plugin): align *_usage arg descriptions with dashboard contract
89a280d docs(opendesign): record lane 0.5.38 release verification
56c9e38 fix(plugin): ship the tool arg one-shot fix in 0.5.38
1a9bfc6 docs(opendesign): record lane P follow-up patch release proof
664c1c5 fix(plugin): ship OpenDesign cache rates and correct usage description
9afa54e chore(release): bump versions, parity harness and four-binary docs
94dc584 feat(mpc): OpenDesign packaged rates and pricing
2d58bc1 feat(plugin): OpenDesign tool and sidebar family parity
b40be42 feat(oduse): account snapshot meter, statusline and MCP parity
3438cfa feat(oduse): re-source OpenDesign rates from published model-prices
```

## Job

1. `git fetch origin`, then create the worktree `~/dev/worktrees/cmdcode-tools/reconcile-main` from
   `origin/main` on a new branch `reconcile-main`. One worktree, never inside the repo.
2. `git merge main`. Expect five conflicts, all in `opencode-plugin`:
   `package.json`, `src/catalogOpenDesign.ts`, `src/index.ts`, `test/catalogOpenDesign.test.ts`,
   `test/plugin.test.ts`.
3. Resolution rule: the local side is the released **0.5.39** line and the origin side is the older
   **0.5.36** squash. Take the local side for these files, but for each one diff the two sides and
   **port any origin-only hunk local lacks** — PR #37 may have added work the 0.5.39 line never saw.
   Version stays `0.5.39`. Say in the report which origin-only hunks existed and what you did with
   each.
4. Resolve any further conflicts the same way: newer feature line wins, but nothing from origin is
   dropped silently. Website snapshots (`website/src/data/*.json`) are generated — take `origin/main`'s
   side, it is fresher.
5. `bun install` in the worktree, then run exactly what CI runs for the touched packages (read
   `.github/workflows/ci.yml`): tests, typecheck, format check, build. Green, or say what is red and why.
6. Commit the merge — `merge: reconcile released 0.5.39 line with main (#37 cycle)` — and stop there.
   Do not push, do not tag, do not bump a version.

Report to `docs/plan/reconcile-main/report.md`: the five resolutions with the hunks you kept from
each side, the gates with their output, and a one-line list of every file that ended up different
from `origin/main`.
