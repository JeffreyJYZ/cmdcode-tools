# Lane B report — skills for every tool

## Files written

| File | Lines |
| --- | --- |
| `skills/cmdcode-tools/SKILL.md` | 47 |
| `skills/cmduse/SKILL.md` | 59 |
| `skills/mpc/SKILL.md` | 51 |
| `skills/opencode-context/SKILL.md` | 42 |
| `skills/opencode-plugin/SKILL.md` | 54 |
| `skills/opencode-session-dir/SKILL.md` | 50 |
| `skills/opencode-shell-rc/SKILL.md` | 65 |
| `skills/reqshape/SKILL.md` | 52 |
| `README.md` (Skills section only) | +10 |
| `docs/plan/skills-and-guards/lane-b.md` | this report |

Every skill is under 200 lines, has `name` + `description` frontmatter, and a description that starts with "Use when", names situations/symptoms a user says, and states no workflow. No prose is hard-wrapped.

## Discovery verification

Command, from the repo root: `skills add . --list`. The CLI detected opencode, validated the local path, and found 8 skills. No git remote was required for the local-directory form; `skills add JeffreyJYZ/cmdcode-tools` uses the same `skills/<name>/SKILL.md` discovery path.

```
Source: /Users/jyz/dev/cmdcode-tools
Local path validated
Found 8 skills

Available Skills

  cmdcode-tools
    Use when the user mentions the cmdcode-tools repo or Command Code tooling, or asks which tool covers usage dashboards, model price comparison, request-shape measurement, shell aliases, context breakdowns, or per-session working directories.

  cmduse
    Use when the user wants a Command Code, OpenCode Go/Zen, ARK Agent Plan or OpenDesign usage dashboard, daily or hourly reports, a statusline, a per-model or per-project report, or an MCP usage server, or says a plan window is near its cap.

  mpc
    Use when the user asks which plan is cheaper for a model, how many requests an allowance buys, or wants a per-model price table across OpenCode Go, Command Code and OpenDesign, or their own usage projected onto those plans.

  opencode-context
    Use when the user asks why their context is already high, what is filling the window, or how much room is left before compaction, and wants the /context dialog or a context_breakdown answer.

  opencode-plugin
    Use when the user wants Command Code models and a usage sidebar in opencode, hits the /connect auth flow, or asks about cmd_usage, mpc_prices, /cmd-usage, /ocuse-usage, /arkuse-usage or /oduse-usage.

  opencode-session-dir
    Use when the user needs the agent to work in a sibling repo or a directory outside the session root without repeated external_directory approvals, or wants that access to survive a restart.

  opencode-shell-rc
    Use when the user's agent shell reports command not found for an alias that works in their own terminal, when they want a habit command like grep or sed blocked in agent shells, or when they need agent-only environment variables without touching .zshrc.

  reqshape
    Use when the user asks what their real per-request token shape is, why cache read dominates, or wants deep-context traffic priced against models instead of a fixed workload assumption.

Use --skill <name> to install specific skills
```

All eight names correct, no duplicates, no internal/metadata-hidden skills.

## Source verified per skill

Skill layout and frontmatter rules: `~/.bun/install/global/node_modules/skills/docs/creating-skills.md` (required `name` + `description`; `skills/<name>/SKILL.md` discovery, three levels deep). List semantics from `docs/commands.md` (`-l, --list` = list without installing).

| Skill | Verified against |
| --- | --- |
| `cmdcode-tools` | Root `AGENTS.md` (bin names, env var overrides, release tags, `core/` JSON as source of truth), root `README.md` (project table, install paths). |
| `cmduse` | `cmduse/README.md`; live `cmduse --help` (all flags: `-1`, `-p`, `-i`, `-w`, `-b`, `--json`, `--csv`, `--gated`, `--tz`, `--days`, `--hours`, `--since`, `--rows`, `--local`, `config set`); root `AGENTS.md` for parity and `-1 --json` error-envelope trap. |
| `mpc` | `oc-cmd-compare/README.md`; `oc-cmd-compare/package.json` (`bin`: `mpc`, `mpcdev`; deps `cac`); live `mpc --help` (all flags incl. `--cc-plan`, `--oc-plan`, `--od-plan`, `--shape`, `--usage*`, `--columns`, `--bench`, `--check`); root `AGENTS.md` for `--shape off` cycle break and `--json` consumer contract. |
| `reqshape` | `reqshape/README.md`; `reqshape/package.json` (`bin`: `reqshape`, `reqshapedev`); live `reqshape --help` (all flags incl. `--weight`, `--sessions`, `--format`, `--db`, `--mpc`, `--cmduse`, custom-model flags). |
| `opencode-plugin` | `opencode-plugin/README.md` (install, auth order, command/tool table, config keys, env overrides); `opencode-plugin/package.json` (npm name, `exports` `./tui`, no bin). |
| `opencode-shell-rc` | `opencode-shell-rc/README.md` (mechanism, config paths, `env` map, traps), `opencode-shell-rc/AGENTS.md` (guard/env rules and traps), `opencode-shell-rc/package.json` (no bin); **new `blocked` schema from `docs/plan/skills-and-guards/schema.md`** — array of `{name, alternative?, reason?}`, message rules, backwards compatibility, generated-script escaping. The old string map in the current README is documented as legacy only. Lane A's in-flight edits to `opencode-shell-rc/**` were not read or touched for this. |
| `opencode-context` | `opencode-context/README.md` (`/context`, `context_breakdown`, cache path), `opencode-context/AGENTS.md` (bytes vs tokens, replayable context, TUI build trap), `opencode-context/package.json`. |
| `opencode-session-dir` | `opencode-session-dir/README.md` (three slash commands, bindings file, env flag), `opencode-session-dir/AGENTS.md` (session-scope and allow-only rules, boundary matching), `opencode-session-dir/package.json`. |

No command, flag or env var in any skill was invented: CLI flags were checked against the installed binaries' `--help`, and plugin config against each package's own README/AGENTS and `package.json`.

## Scope

- No file under `opencode-shell-rc/**` was edited.
- Pre-existing uncommitted files (`oc-cmd-compare/src/index.ts`, `reqshape/src/index.ts`, `docs/plan/opendesign/reports/scratch/*`, and lane A's own `opencode-shell-rc/**` changes as they appeared) were left untouched.
- No `.claude-plugin/` manifest added; `skills/` is the only discovery path used.
- Root `README.md` diff is the single `## Skills` section shown above; nothing else moved.
