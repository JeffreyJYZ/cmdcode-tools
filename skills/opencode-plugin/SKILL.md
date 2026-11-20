---
name: opencode-plugin
description: "Use when the user wants Command Code models and a usage sidebar in opencode, hits the /connect auth flow, or asks about cmd_usage, mpc_prices, /cmd-usage, /ocuse-usage, /arkuse-usage or /oduse-usage."
---

# opencode-plugin

`@jeffreyjyz/opencode-command-code` — one package covering both opencode plugin APIs (v1 `server()` and v2 `{ id, setup }`). Registers two provider lanes against `api.commandcode.ai`: `command-code-anthropic` (Claude) and `command-code-openai` (everything else), with a live gated model list, published $/1M rates, and a usage sidebar. All usage rendering is delegated to the `cmduse` CLI.

## Install

In `~/.config/opencode/opencode.json` (v2 `plugins`, v1 singular `plugin` is auto-normalized):

```json
{ "plugins": ["@jeffreyjyz/opencode-command-code"] }
```

Requires the usage CLI on `PATH` — `brew install JeffreyJYZ/tap/cmduse`. For the sidebar's per-model catalog (tier, rates, allowance, deals) install `bun add -g @jeffreyjyz/mpc`; without it those rows are simply omitted.

Auth: run `/connect`, choose **Command Code**, paste a key (create one at commandcode.ai/settings/keys); or set `CMD_API_KEY`; or `cmd login`. With no credential the providers register as `auto`, so a later `/connect` lights them up without a restart.

## Commands and tools

| Command         | Tool           | Spawns   |
| --------------- | -------------- | -------- |
| `/cmd-usage`    | `cmd_usage`    | `cmduse` |
| `/ocuse-usage`  | `ocuse_usage`  | `ocuse`  |
| `/arkuse-usage` | `arkuse_usage` | `arkuse` |
| `/oduse-usage`  | `oduse_usage`  | `oduse`  |
| —               | `mpc_prices`   | `mpc`    |

An empty argument on the ocuse/arkuse/oduse tools means the one-shot dashboard (`-1`); a bare binary would be a watch loop that never returns. `/cmd-settings` is a dialog over the config file (colours, plan choices, refresh cadence, local cost rows).

## Config

`~/.config/opencode/command-code.json`, re-read every few seconds:

```json
{ "colors": true, "ocPlan": "go-plus", "odPlan": "pro" }
```

Env overrides for a single run: `CMD_COLORS=1|0`, `CMD_OC_PLAN=go|go-plus`, `CMD_OD=1|0`, `CMD_OD_PLAN=go|plus|pro|max`. `ocPlan`/`odPlan` pick per-model limits because nothing local records which plan is active.

## Traps

- The sidebar updates from `cmduse` polled every 5s; every block keeps its last good reading so an outage repaints instead of blanking. Do not add a code path that clears a block on a non-actionable failure.
- Per-model usage is read from opencode's store (`~/.local/share/opencode/opencode.db`, read-only); subscription spend appears only when the harness priced the turns.
- `dist/index.js` must import only node builtins at runtime, so a fresh start does not install the ~270 MB provider graph before the provider appears. `@opencode/*` stays devDependency, type-only.
- Pin the plugin to an exact version in `opencode.json` (`@jeffreyjyz/opencode-command-code@<version>`) to skip the `@latest` registry round trip; take `<version>` from `npm view`, never hardcode it.
- v1 caveat: its `/connect` entry is bound to the Anthropic lane; the OpenAI lane needs `cmd login` or `CMD_API_KEY` in a `/connect`-only v1 setup.
- Credential order: `CMD_API_KEY`, opencode credential store, legacy `auth.json`, `~/.commandcode/auth.json`. A 401 is skipped for the next candidate — do not treat it as a dead endpoint.
- Local-directory loading resolves `index`/`tui` beside the package root; keep the root shims in sync with `dist/`.

Details: [opencode-plugin README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-plugin#readme).
