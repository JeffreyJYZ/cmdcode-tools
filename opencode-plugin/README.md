# @jeffreyjyz/opencode-command-code

Command Code providers, a live gated model list and a usage sidebar for opencode, with all usage rendering delegated to the `cmduse` CLI.

[![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-command-code?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/opencode-command-code) [![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

One package, both opencode plugin APIs: v1 hosts call the default export's `server()` hook map, v2 hosts decode `{ id, setup }` and call `setup(context)`. The two halves are independent implementations sharing one CLI layer, and neither reimplements usage math — every window figure comes from the `cmduse` binaries.

It registers two provider lanes against `api.commandcode.ai`:

- `command-code-anthropic` — Claude models on the Anthropic wire.
- `command-code-openai` — everything else on the OpenAI-compatible wire, where the reasoning text is round-tripped through `reasoning_content` so a compaction or model switch doesn't get rejected.

The model list is fetched live from Command Code's listing API, split by wire, and gated to your plan (`core/gating.json` in the repo is the source of truth). The picker never waits on the network: a static seed from the known-model table, then the last live list cached on disk, paint instantly and the live fetch merges over them — union by model id, so a gated or partial response can never make a model vanish. On v2 hosts the fetch then repeats on an interval, and a tick only touches the provider registry when the model ids actually changed.

Each model is registered with Command Code's published $/1M rates, so opencode's own cost display works for a subscription provider instead of showing $0. Vision support and reasoning-effort variants come from a generated catalog, because the listing API publishes no capabilities.

Credentials resolve in one order everywhere: `CMD_API_KEY`, then the key `/connect` stored in opencode's credential store, then `~/.commandcode/auth.json` from `cmd login`.

## Install

Add the plugin to `opencode.json` (v2 hosts use `plugins`; v1's singular `plugin` is auto-normalized):

```json
{
  "plugins": ["@jeffreyjyz/opencode-command-code"]
}
```

Usage rendering needs the `cmduse` CLI on `PATH` — it owns the plan table, the window math and the formatting:

```sh
brew install JeffreyJYZ/tap/cmduse
```

The sidebar's per-model catalog (tier, rates, allowance, deals) comes from `mpc`, which is optional: without it the section keeps the model name and the store-backed rows and simply omits the catalog rows.

```sh
bun add -g @jeffreyjyz/mpc
```

## Usage

Run `/connect`, choose **Command Code** and paste an API key (create one at commandcode.ai/settings/keys), or use the `CMD_API_KEY` env method, or log in once with `cmd login`. With no credential at all the providers register as `auto`, so a later `/connect` lights them up without a restart.

One caveat on the v1 half: its `/connect` entry is bound to the Anthropic lane (opencode's plugin API allows one auth hook per provider id), so the OpenAI lane shares the key through the resolved `options.apiKey` — a `/connect`-only v1 setup needs `cmd login` or `CMD_API_KEY` for that lane.

While a session uses a Command Code, OpenCode Go/Zen or Volcengine ARK model, the sidebar grows one section for that family — plain text unless you ask for colour. Write `~/.config/opencode/command-code.json`:

```json
{ "colors": true, "ocPlan": "go-plus" }
```

`CMD_COLORS=1` (or `0`) and `CMD_OC_PLAN=go|go-plus` override it for a single run. `ocPlan` only matters on the Go side: the two Go plans share token prices but grant different per-model limits and nothing local records which one you have. The file is re-read every few seconds, so a flip lands on the next poll.

What the section shows:

- plan, price, monthly credits used, and the 5-hour / weekly windows with used / cap, percent used, elapsed share, reset countdown and a `cap in …` pace estimate; an over-cap window is flagged `LIMIT EXCEEDED`
- this period's requests and spend, the active model's tier, allowance and $/M rates, its `Usage (this model)` share, any running `Deal`, and this session's own totals
- on OpenCode Go/Zen and ARK sessions, the same shape from `ocuse` and `arkuse` instead — account meters where the provider publishes them, per-model spend from opencode's own store

Usage comes from `cmduse` polled every 5 seconds, read from opencode's message store for the per-model and per-session rows, and cached from `mpc` for the catalog. Every block remembers its last reading, so a remount, a session switch or a network outage repaints instead of blanking; the model figure is keyed by model and session, so switching models never shows the previous model's numbers.

## Commands

Each command passes its arguments through to the CLI that owns it, and each has an agent-facing tool of the same name, so the model can fetch the same text without you typing a slash command.

| Command | Tool | Spawns |
|---|---|---|
| `/cmd-usage` | `cmd_usage` | `cmduse` — plan, credits, windows, billing period; `plans` for the plan table |
| `/ocuse-usage` | `ocuse_usage` | `ocuse` — OpenCode Go/Zen meters and per-model spend; empty args mean `-1` |
| `/arkuse-usage` | `arkuse_usage` | `arkuse` — Volcengine ARK Agent Plan meters in AFP; empty args mean `-1` |
| — | `mpc_prices` | `mpc` — per-model price comparison across Command Code and OpenCode Go plans |

A bare `ocuse` or `arkuse` is a live watch loop that would never return to the dialog, so an empty argument means the one-shot dashboard.

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-plugin)
- [npm](https://www.npmjs.com/package/@jeffreyjyz/opencode-command-code)
- [`cmduse` CLI](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/cmduse) — the usage renderer this plugin spawns
- [MIT license](LICENSE)
