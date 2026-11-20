# Brief — which package actually needs a cut

Read-only audit. Repo: `~/dev/cmdcode-tools`. Read the root `AGENTS.md` first.

A merge is landing 13 commits that were released by tag (`plugin-v0.5.38`, `plugin-v0.5.39`,
`mpc-v0.1.14`) but never merged into `main`. Before anything is tagged, work out exactly what the
registry is missing.

## Do

For every publishable package — `opencode-plugin`, `opencode-shell-rc`, `opencode-context`,
`opencode-session-dir`, `oc-cmd-compare`, `reqshape` — report:

1. the version in its `package.json` on **local `main`**
2. the version currently on npm (`bun info <name> version`)
3. its latest tag in this repo, and whether that tag's commit is an ancestor of local `main`
4. every commit touching that package's directory since that tag (`git log --oneline <tag>..main -- <dir>`), with a one-line note on whether the change is user-visible
5. the verdict: `no cut needed` / `cut <pkg>-v<next>`, with the exact tag name

Also check whether any tag in this repo points at a commit that is **not** on `origin/main` yet, and
list them — those are the "released but unmerged" ones.

## Do not

Write anything except your report. No tags, no version bumps, no pushes, no `bun install`, no builds.
Do not touch the working tree, which carries another session's uncommitted files.

Report to `docs/plan/reconcile-main/release-audit.md` as a table plus the no-cut list.
