# Brief — lane B: skills for every tool in the repo

Repo: `~/dev/cmdcode-tools`. Read the root `AGENTS.md` and `README.md` first.

Goal: `skills add JeffreyJYZ/cmdcode-tools` installs a skill per tool, with no manual layout work.
The `skills` CLI (v1.9.0, `~/.bun/install/global/node_modules/skills`) discovers
`skills/<name>/SKILL.md`, up to three levels deep, in that exact container. Read its
`docs/creating-skills.md` before writing anything — required frontmatter is `name` and `description`,
and that file is the authority, not this brief.

## Write these

One directory per tool under `skills/`, each a `SKILL.md` with frontmatter and a body:

- `skills/cmdcode-tools/SKILL.md` — umbrella: what the repo ships, which skill to reach for, the
  binary/pin names
- `skills/opencode-shell-rc/SKILL.md` — the zsh shim, `shell-rc.json` (`env` and `blocked`), the
  guard layer. Use the **new** `blocked` schema from `docs/plan/skills-and-guards/schema.md`; it is
  landing as 0.5.0 in a parallel lane. Do not describe the old string-only map as current.
- `skills/opencode-plugin/SKILL.md`
- `skills/opencode-context/SKILL.md`
- `skills/opencode-session-dir/SKILL.md`
- `skills/mpc/SKILL.md` — the `oc-cmd-compare` package, binary `mpc`
- `skills/reqshape/SKILL.md`
- `skills/cmduse/SKILL.md` — the Rust CLI (`cmduse/`, crate `cmd-usage`)

## How to write each one

- Read that package's `README.md`, `package.json` `bin`/`scripts`, and the source entry point. Every
  command, flag and env var you name must exist — check `--help` output or the parser, never invent.
- `description` is the trigger: name the situations a user would say, not the internals. One
  sentence or two, concrete nouns.
- Body: what it is, how it is installed (`bun add -g <pkg>`, `brew install` if that is the real path),
  the one or two commands that matter, config file and key names, and a **Traps** list with the
  gotchas the package's own AGENTS/README records. Link to the package README rather than copying it.
- Under 200 lines each. No hard-wrapped prose.

## Repo wiring

- Root `README.md`: a short "Skills" section showing `skills add JeffreyJYZ/cmdcode-tools` and listing
  the skill names. Nothing else in the README moves.
- Do not edit `opencode-shell-rc/**` — lane A owns that package. Do not touch the working tree's
  uncommitted files (`oc-cmd-compare/src/index.ts`, `reqshape/src/index.ts`, the opendesign scratch
  scripts).
- Do not add `.claude-plugin/` manifests; `skills/` is the discovery path.

## Verify

From the repo root: `skills add . --list` (or the documented local-directory form) must list every
skill you wrote, with the right names and no duplicates. Paste that output in the report. If the CLI
insists on a git remote, say so and instead prove the tree matches the documented discovery rule.

Report to `docs/plan/skills-and-guards/lane-b.md`: the file list with line counts, the discovery
output, and for each skill the source you verified its commands against.
