---
name: reqshape
description: "Use when the user asks what their real per-request token shape is, why cache read dominates, or wants deep-context traffic priced against models instead of a fixed workload assumption."
---

# reqshape

The `@jeffreyjyz/reqshape` package (`reqshape/`), binary `reqshape`. A **req** is one model call (one `assistant` row in opencode's store), not one user prompt. It reads history, averages it into a token vector — e.g. 8.2K input / 309 output / 139 reasoning / 248K cache read — then prices that vector against models from `mpc`. Where `mpc` assumes a fixed 800-in / 50K-cache / 200-out workload, `reqshape` uses your actual traffic.

## Install

```sh
bun add -g @jeffreyjyz/reqshape
```

From a checkout, `bun install` then `bun run src/index.ts --help`, or `bun link`. `bun run dev:link` points the `reqshapedev` twin at the checkout; `--mpc mpcdev` (or `MPC_BIN=mpcdev`) prices through a working-copy mpc.

## Commands

```sh
reqshape                                # the measured shape and projection
reqshape --weight session --sort cost   # one vote per conversation, sort by cost
reqshape --format json                  # payload for mpc --shape <file>
reqshape --explain                      # every structural-noise drop reason
reqshape --model kimi --limit 10        # filter and cap model rows
reqshape --since 2026-08-01             # only asks on/after this date
```

Custom model nobody sells:

```sh
reqshape --in 0.15 --out 0.6 --cache-read 0.003 --budget 60 --five-hour 12 --weekly 30
```

`--budget` is the monthly allowance; `--five-hour`/`--weekly` are plan caps — without them those columns show `—`. Omit `--cache-read` and context is billed at the input rate, flagged `*`.

## Sources and config

- Traffic: opencode's read-only store (`~/.local/share/opencode/opencode.db`, `OPENCODE_DB`); v2's `session_message` when present, pre-v2 `message` otherwise.
- Rates/allowances: `mpc --json` (`--mpc`, `MPC_BIN`). Account line: `cmduse -1 --json` (`--cmduse`, `CMDUSE_BIN`; `--no-account` skips).
- `--format json` carries `sides.oc` and `sides.cc`: the profile split by provider, which `mpc --shape measured` reads. Runs take ~20s because both mpc and cmduse hit the network.

## Traps

- Cache read dominates and grows with **position in the conversation**: the 101+ bucket re-sends ~300K tokens/request. Per-request average is several times the per-conversation average, so `--weight turn` (default) and `--weight session` answer different questions; both are always printed.
- A model with no published cache-read rate is billed at input rate and flagged `*` — the single biggest swing in the table.
- Structural noise is dropped: `synthetic`, `compaction`, `shell`, `system` rows and asks whose model was never called. Every prompt you typed counts, however short.
- Bytes vs tokens: classification lives in one place (`breakdown.ts` in opencode-context is a different package); reqshape's per-req numbers are raw token counts from the store, not estimates.
- `--format json` is a contract with mpc; changing its shape means updating mpc's `--shape` reader in the same effort.
- Flags are parsed with `cac`; check `reqshape --help` before naming one. Never invent a flag.

Details: [reqshape README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/reqshape#readme).
