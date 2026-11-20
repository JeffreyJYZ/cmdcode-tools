---
name: cmdcode-tools
description: "Use when the user mentions the cmdcode-tools repo or Command Code tooling, or asks which tool covers usage dashboards, model price comparison, request-shape measurement, shell aliases, context breakdowns, or per-session working directories."
---

# cmdcode-tools

Umbrella skill for the `JeffreyJYZ/cmdcode-tools` monorepo. One git repo; each subdirectory is an independent package sharing no code. Coupling is through **installed binaries and published plugins**, never relative paths.

## Which skill to reach for

| Situation                                                                                      | Skill                  | Package                       |
| ---------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------- |
| Command Code / OpenCode Go / ARK / OpenDesign usage dashboard, reports, statusline, MCP server | `cmduse`               | `cmduse/` (crate `cmd-usage`) |
| Compare what the same model costs on Go vs Command Code vs OpenDesign plans                    | `mpc`                  | `oc-cmd-compare/`             |
| Measure real per-request token shape from opencode history                                     | `reqshape`             | `reqshape/`                   |
| Command Code providers, live model list, usage sidebar in opencode                             | `opencode-plugin`      | `opencode-plugin/`            |
| Agent shell does not see your zsh aliases, or block a habit command                            | `opencode-shell-rc`    | `opencode-shell-rc/`          |
| Where the context window went (`/context`, `context_breakdown`)                                | `opencode-context`     | `opencode-context/`           |
| Bind extra working dirs to one opencode session                                                | `opencode-session-dir` | `opencode-session-dir/`       |

## Names to know

- Rust bins (one crate, `cmd-usage`): `cmduse`, `ocuse`, `arkuse`, `oduse`. Dev twins: `cmdusedev`, `ocusedev`, `arkusedev`, `odusedev`.
- npm packages: `@jeffreyjyz/opencode-command-code`, `@jeffreyjyz/opencode-shell-rc`, `@jeffreyjyz/opencode-context`, `@jeffreyjyz/opencode-session-dir`, `@jeffreyjyz/mpc` (bin `mpc`, twin `mpcdev`), `@jeffreyjyz/reqshape` (bin `reqshape`, twin `reqshapedev`).
- Binary overrides for consumers: `CMDUSE_BIN`, `OCUSE_BIN`, `ARKUSE_BIN`, `ODUSE_BIN`, `MPC_BIN`, `REQSHAPE_BIN`. Default to the global command name; point them at a `*dev` twin when testing a checkout.
- npm release tags map one tag to one package: `plugin-v*`, `shell-rc-v*`, `context-v*`, `session-dir-v*`, `mpc-v*`, `reqshape-v*`. Rust releases use `cmduse-v*`.

## Install the tools

```sh
brew install JeffreyJYZ/tap/cmduse   # the four usage CLIs
bun add -g @jeffreyjyz/mpc
bun add -g @jeffreyjyz/reqshape
```

Plugins go in the `plugins` array of `~/.config/opencode/opencode.json`. Never restart or reload opencode yourself; the user does that.

## Traps

- Packages share no code; do not add relative imports between them. Coupling is via installed binaries/published plugins.
- Shared truth lives in `core/` JSON (`plans.json`, `gating.json`, `zen.json`, `ark.json`, `od.json`). Edit JSON, never generated consts.
- All four usage binaries stay at feature parity: a flag one gains lands in all four in the same commit.
- Publishing needs explicit user go; never push, publish, or tag without it.
- Root `README.md` is the canonical docs page; the website derives from it, so do not fork prose.

Full inventory and design rules: [repo README](https://github.com/JeffreyJYZ/cmdcode-tools#readme) and [root AGENTS.md](https://github.com/JeffreyJYZ/cmdcode-tools/blob/main/AGENTS.md).
