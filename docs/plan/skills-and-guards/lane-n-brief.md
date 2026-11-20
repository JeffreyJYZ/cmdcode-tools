# Brief — lane N: compatibility audit, read-only

Repo: `~/dev/cmdcode-tools`. Read the root `AGENTS.md` first.

House rule now in force: **every release keeps parsing what it already wrote**, and a format that
gains a new shape ships a converter, not just a parser. Audit the repo against that rule.

## Do

For each publishable package (`opencode-plugin`, `opencode-shell-rc`, `opencode-context`,
`opencode-session-dir`, `oc-cmd-compare`, `reqshape`) and for the Rust `cmduse` tree:

1. List every thing it persists or reads from disk outside its own source: config files, state dirs,
   cache files, lockfiles, generated scripts, SQLite or JSON on disk.
2. For each, state whether the current code still accepts data written by the previous released
   version. Read the parser; do not assume.
3. Name any format that changed shape in a release **without** a compatibility path, and any format
   whose old shape would now throw, be silently ignored, or be silently rewritten.
4. Flag anything that rewrites a user's file without a backup.

## Do not

Change code, run migrations, or write outside one report file. No builds, no `bun install`, no
network. Do not touch the working tree's uncommitted files.

Report to `docs/plan/skills-and-guards/compat-audit.md` as a table per package: what is persisted,
old-shape still accepted (`yes`/`no`/`n/a`), evidence (file and line), and the verdict. End with a
short list of the real gaps in priority order.
