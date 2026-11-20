# Release audit — reconcile main

Read-only audit of every publishable npm package in `~/dev/cmdcode-tools`. No tags, bumps, pushes, installs, builds or working-tree edits were made.

Reference points:

- local `main` = `2674838af1df2a6c294a6096ed5a14f56b5af737`
- `origin/main` = `815a6c3e2e7911cee548cb688b78ed0f27a316cd`
- merge base = `6dedfc56150f301741a199c7ac760e5c866a29d3`
- `git rev-list --count origin/main..main` = 13; `git rev-list --count main..origin/main` = 10. The two lines diverged from the merge base; local `main` is not a fast-forward of `origin/main`.

## Summary table

| Package dir | npm name | version on local `main` | npm `version` / `latest` | latest repo tag | tag commit on local `main`? | commits on `main` since tag touching dir | Verdict |
|---|---|---|---|---|---|---|---|
| `opencode-plugin` | `@jeffreyjyz/opencode-command-code` | 0.5.39 | 0.5.39 / 0.5.39 | `plugin-v0.5.39` (`0a73a58`) | YES (NOT on `origin/main`) | none | `no cut needed` |
| `opencode-shell-rc` | `@jeffreyjyz/opencode-shell-rc` | 0.4.2 | 0.4.3 / 0.4.3 | `shell-rc-v0.4.3` (`815a6c3`) | NO (on `origin/main`) | none | `no cut needed` — registry already ahead |
| `opencode-context` | `@jeffreyjyz/opencode-context` | 0.1.2 | 0.1.2 / 0.1.2 | `context-v0.1.2` (`9140c34`) | YES | none | `no cut needed` |
| `opencode-session-dir` | `@jeffreyjyz/opencode-session-dir` | 0.1.1 | 0.1.1 / 0.1.1 | `session-dir-v0.1.1` (`2d1638a`) | YES | none | `no cut needed` |
| `oc-cmd-compare` | `@jeffreyjyz/mpc` | 0.1.14 | 0.1.14 / 0.1.14 | `mpc-v0.1.14` (`0bd6074`) | NO (on `origin/main`) | 2 (`94dc584`, `2674838`) | `cut mpc-v0.1.15` |
| `reqshape` | `@jeffreyjyz/reqshape` | 0.2.3 | 0.2.3 / 0.2.3 | `reqshape-v0.2.3` (`6b96599`) | YES | none | `no cut needed` |

npm figures from `bun info <name> version` and `bun info <name> dist-tags`. Local versions from `git show main:<dir>/package.json` (working tree is dirty from another session and was not used).

## Per-package detail

### opencode-plugin — no cut needed

- Local `main` 0.5.39; npm 0.5.39, `latest` 0.5.39.
- `plugin-v0.5.39` points at `0a73a58` (`chore(opencode-plugin): bump version to 0.5.39`), an ancestor of local `main` but not of `origin/main`.
- `git log --oneline plugin-v0.5.39..main -- opencode-plugin` is empty. The only commits above the tag on `main` are `cfab9af` (docs) and `2674838` (mpc), neither touching this directory.
- Verdict: registry already has 0.5.39 and the tag commit is on local `main`. No new plugin change to publish. Note the tag is one of the released-but-unmerged ones relative to `origin/main`.

### opencode-shell-rc — no cut needed

- Local `main` 0.4.2; npm 0.4.3, `latest` 0.4.3 (versions list ends `0.4.2`, `0.4.3`). Registry is one patch **ahead** of local `main`.
- `shell-rc-v0.4.3` points at `815a6c3` (`fix(opencode-shell-rc): write a guard for a command with no replacement (#39)`), an ancestor of `origin/main` but not of local `main`.
- `git log --oneline shell-rc-v0.4.3..main -- opencode-shell-rc` is empty; `git log --oneline shell-rc-v0.4.2..main -- opencode-shell-rc` is also empty. Local `main`'s last change here is `1b2dc6f` (the 0.4.2 release bump).
- Verdict: nothing on local `main` is missing from the registry. The 0.4.3 guard fix (`guards.ts`, `test/guards.test.ts`, `test/shim.test.ts`) arrives with the merge from `origin/main`; it does not need a new tag from this side.

### opencode-context — no cut needed

- Local `main` 0.1.2; npm 0.1.2, `latest` 0.1.2.
- `context-v0.1.2` (`9140c34`) is an ancestor of local `main` and of `origin/main`.
- `git log --oneline context-v0.1.2..main -- opencode-context` is empty.
- Verdict: no cut.

### opencode-session-dir — no cut needed

- Local `main` 0.1.1; npm 0.1.1, `latest` 0.1.1.
- `session-dir-v0.1.1` (`2d1638a`) is an ancestor of both refs.
- `git log --oneline session-dir-v0.1.1..main -- opencode-session-dir` is empty.
- Verdict: no cut.

### oc-cmd-compare — cut mpc-v0.1.15

- Local `main` 0.1.14; npm 0.1.14, `latest` 0.1.14.
- `mpc-v0.1.14` points at `0bd6074` (`feat: OpenDesign release 0.8.4 — rates, account meter, four-binary parity (#37)`), an ancestor of `origin/main` **not** of local `main`. Local `main` reached version 0.1.14 independently in `94dc584`, so the string "0.1.14" names two different trees: published 0.1.14 is the `0bd6074` tree, not local `main`'s.
- `git log --oneline mpc-v0.1.14..main -- oc-cmd-compare` returns two commits:
  - `94dc584` `feat(mpc): OpenDesign packaged rates and pricing` — **user-visible**: ships OpenDesign token rates inside the tarball (`src/data/sources/od/od.generated.ts`, ~533 lines), bumps `0.1.13` → `0.1.14`, adds `extract:od` script, changes `--check` output (new "OpenDesign cross-priced" line and reworded "unpriced" line); 13 files, +1013/−119.
  - `2674838` `feat(mpc): read every OpenDesign-adjacent ability source, not just the top-N chart` — **user-visible**: new AA leaderboard/web/flight sources, ability scoring and constants change, so benchmark output changes; 12 files, +329/−62.
- Verdict: `cut mpc-v0.1.15` (bump `oc-cmd-compare/package.json` `0.1.14` → `0.1.15`; PATCH per the incremental-work rule in root `AGENTS.md`). Rebuild after the bump because `dist/` embeds the version string. A plain re-tag of 0.1.14 is wrong: that version is already on the registry with different content.

### reqshape — no cut needed

- Local `main` 0.2.3; npm 0.2.3, `latest` 0.2.3.
- `reqshape-v0.2.3` (`6b96599`) is an ancestor of both refs.
- `git log --oneline reqshape-v0.2.3..main -- reqshape` is empty.
- Verdict: no cut.

## Tags pointing at commits not on `origin/main` (released but unmerged)

From `git merge-base --is-ancestor <tag> origin/main` over all tags (`git tag`):

| Tag | Commit | On local `main`? | Note |
|---|---|---|---|
| `plugin-v0.5.37` | `664c1c5` | YES | Released plugin fix (OpenDesign cache rates, usage description) on the local-main line only. |
| `plugin-v0.5.38` | `56c9e38` | YES | Released tool-arg one-shot fix on the local-main line only. |
| `plugin-v0.5.39` | `0a73a58` | YES | Released plugin bump on the local-main line only. |
| `cmduse-v0.7.28` | `8cae65b` | NO | Orphan: `git branch -a --contains` is empty; on neither local `main` nor `origin/main`. |

Tags already present on `origin/main` at the relevant tips: `mpc-v0.1.14` (`0bd6074`), `cmduse-v0.8.4` (`0bd6074`), `shell-rc-v0.4.3` (`815a6c3`). Every other tag is an ancestor of both refs.

## Bottom line

The registry is missing exactly one publishable change: mpc's two post-tag commits on local `main`. Cut `mpc-v0.1.15` after the merge settles. Everything else is either already published at the same version (`opencode-plugin`, `opencode-context`, `opencode-session-dir`, `reqshape`) or already published one patch ahead of local `main` (`opencode-shell-rc`).

## Evidence commands

- `git branch --show-current`, `git log -1 --oneline`, `git status --short`
- `git show main:<dir>/package.json | rg '"(name|version)"'` for each of the six dirs
- `bun info <name> version`, `bun info <name> dist-tags`, `bun info @jeffreyjyz/opencode-shell-rc versions`
- `git tag --sort=-version:refname`
- `git merge-base --is-ancestor <tag> main|origin/main` per tag
- `git log --oneline <tag>..main -- <dir>` per package
- `git rev-list --count origin/main..main`, `git rev-list --count main..origin/main`, `git merge-base main origin/main`
- `git show --stat --oneline 94dc584 -- oc-cmd-compare`, `git show --stat --oneline 2674838 -- oc-cmd-compare`
