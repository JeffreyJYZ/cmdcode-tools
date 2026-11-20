---
name: mpc
description: "Use when the user asks which plan is cheaper for a model, how many requests an allowance buys, or wants a per-model price table across OpenCode Go, Command Code and OpenDesign, or their own usage projected onto those plans."
---

# mpc

The `@jeffreyjyz/mpc` package (`oc-cmd-compare/`), binary `mpc`. Normalizes OpenCode Go, Command Code, and optionally OpenDesign onto one per-model table: how many requests a month each plan buys and what each request really costs.

## Install

```sh
bun add -g @jeffreyjyz/mpc
```

From a checkout, `bun install` then `bun run src/index.ts --help`, or `bun link`. For development, `bun run dev:link` points the `mpcdev` twin at the checkout while `mpc` stays the published install (`MPC_BIN` points consumers at a twin).

## Commands

```sh
mpc                                   # oc-go Go vs CommandCode GOAT, default workload
mpc --cc-plan pro                     # go | goat | pro | max10 | max20
mpc --oc-plan go-plus                 # go | go-plus (same rates, higher per-model caps)
mpc --od-plan go                      # add OpenDesign: go | plus | pro | max
mpc --minimal                         # model + req/mo both sides + win + val
mpc --medium                          # allowances + rate views
mpc --detail                          # every column, untrimmed
mpc --model 'kimi|glm' --metric req   # filter, sort by requests/month
mpc --shape off                       # fixed workload (break the reqshape cycle)
mpc --json                            # machine-readable
mpc --check                           # validate live sources, report drift
```

Project real usage: `mpc --usage` with `--usage-window period|all|<n>d`, `--usage-file`, `--usage-db`, `--usage-months`. Inputs are merged from opencode's store (`~/.local/share/opencode/opencode.db`, `OPENCODE_DB`), an external JSONL log (`MPC_USAGE_LOG`), `cmduse model --json --since`, and a session-log scan. `CMDUSE_BIN` tests a dev cmduse.

## Config

`~/.config/mpc/config.json` (or `$XDG_CONFIG_HOME/mpc/config.json`), overridden by flags; `--config <path>` and `--no-config` control it; `--print-config` prints the effective settings. Keys are the camelCase flag names (`ccPlan`, `ocPlan`, `odPlan`, `columns`, `presets`, `metric`, `benchWeight`, `valWeights`, `color`, `plugins`). Plugins (`plugins` or `--plugin a,b`) layer config fragments: defaults < plugins < user config < CLI flags.

## Traps

- Default `--shape auto` calls `reqshape`, which itself calls `mpc --json` — a cycle. The sidebar and any `mpc --json` consumer must pass `--shape off`; `REQSHAPE_BIN` overrides the binary, and a missing one is a warning, not a failure.
- `--only both` restricts to models every compared plan carries; head-to-head totals exclude one-sided rows so a plan cannot "win" on traffic it cannot serve.
- `--json` carries raw `costPerRequest`, `requestsPerMonth`, `requestsPerFiveHour`, `requestsPerWeek`, `tally`, etc. `requestsPerMonth: null` means unlimited, never missing. Absent means unpriced.
- Reasoning bills at the output rate on top of output; a model with no published cache-write rate falls back to its input rate, not free.
- `mpc` writes no cache — every source is fetched live, so a source outage only removes the columns it alone supplies. Values reflect docs at fetch time.
- Free OpenCode models publish `Unlimited` and read `req/mo = ∞`; the docs-only `Free` suffix is stripped generically, so a variant merges onto its base row.
- A new mpc binary needs the plugin's catalog spawn checked: the sidebar expects `--shape off` and `--json`.
- Flags are parsed with `cac`; `--help`/`--version` come from it. Never invent a flag — check `mpc --help`.

Details: [mpc README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/oc-cmd-compare#readme).
