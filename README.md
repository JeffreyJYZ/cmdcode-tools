# Command Code tooling

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml) [![crates.io](https://img.shields.io/crates/v/cmd-usage?style=flat-square)](https://crates.io/crates/cmd-usage) [![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-command-code?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/opencode-command-code) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#license)

Personal tooling for [opencode](https://opencode.ai) and Command Code, kept in one repo. Each subdirectory is an independent package — Cargo crates, npm plugins, and CLIs — sharing no code; coupling is by *installed* binaries and published plugins (via env vars such as `CMDUSE_BIN` / `MPC_BIN` / `REQSHAPE_BIN`, each defaulting to the global command name), never by a relative path. This repo was formerly the standalone `cmduse` repo plus five sibling repos, now folded together at the root.

## Projects

| Project | Dir | What it is |
| --- | --- | --- |
| cmduse | [`core/`](core) · [`cmduse/`](cmduse) · [`opencode-plugin/`](opencode-plugin) | Everything Command Code usage: the `cmd-usage` CLI (`cmduse` / `ocuse` / `arkuse`), the shared `cmduse-core`, and the opencode plugin (`@jeffreyjyz/opencode-command-code`). |
| [`mpc`](oc-cmd-compare) | `oc-cmd-compare/` | Compare model pricing across OpenCode Go and Command Code plans. |
| [`reqshape`](reqshape) | `reqshape/` | Measure the shape of your requests from opencode's own history, then price it against any model. |
| [opencode-context](opencode-context) | `opencode-context/` | opencode plugin: a `/context` dialog plus a `context_breakdown` tool showing where the window went. |
| [opencode-shell-rc](opencode-shell-rc) | `opencode-shell-rc/` | opencode plugin: make the agent's non-interactive `zsh` load your aliases and functions via a fast `ZDOTDIR` shim. |
| [opencode-session-dir](opencode-session-dir) | `opencode-session-dir/` | opencode plugin: bind extra working directories to a single session, durably across restarts. |

Everything Command Code (commandcode.ai) usage lives under `core/` + `cmduse/` + `opencode-plugin/`: a terminal dashboard with a built-in MCP server, and an opencode provider. One Cargo workspace shares the plan table and window math via `cmduse-core`; the opencode plugin is a separate TS package that registers the providers and delegates usage rendering to the `cmduse` CLI. The three `opencode-*` plugins are opencode v2 plugins (server half, and a TUI half where needed). See each project's `AGENTS.md` for design rules and the traps found the hard way.

## cmduse components

| Component | Crate / dir | Install | Docs |
|---|---|---|---|
| `cmduse` CLI | `cmduse/` (crate `cmd-usage`, bin `cmduse`) | [crates.io](https://crates.io/crates/cmd-usage) · [brew](https://github.com/JeffreyJYZ/homebrew-tap) | **[cmduse/README.md](cmduse/README.md)** · [man page](cmduse/cmduse.1) |
| `ocuse` (same crate) | `cmduse/` (bin `ocuse`) | same crate as `cmduse` | OpenCode Go/Zen usage — Go's own usage endpoint plus local data — see below |
| `arkuse` (same crate) | `cmduse/` (bin `arkuse`) | same crate as `cmduse` | Volcengine ARK Agent Plan usage in AFP — control-plane meters plus local data — see below |
| Shared core | `core/` (crate `cmduse-core`) | [crates.io](https://crates.io/crates/cmduse-core) | [docs.rs/cmduse-core](https://docs.rs/cmduse-core) · versioned on its own `2.x` line, not as a pair with the CLI |
| opencode plugin | `opencode-plugin/` (`@jeffreyjyz/opencode-command-code`) | [npm](https://www.npmjs.com/package/@jeffreyjyz/opencode-command-code) | [opencode-plugin/src/index.ts](opencode-plugin/src/index.ts) |

## Install the CLI

```sh
brew install JeffreyJYZ/tap/cmduse     # macOS + Linux, prebuilt binary (no cargo)
cargo binstall cmd-usage               # any platform, prebuilt from the release
cargo install cmd-usage                # build from source (any platform)
```

Then run `cmduse` for the live dashboard, or `cmduse plans` / `cmduse models`.

`cmduse model [--days N | --since ISO] [--json]` reports local per-model usage; without a window it is all-time, so pass one when you mean a billing period. `--json` includes `source` and `since`. There is no account-side per-model endpoint (the API only exposes totals), so local logs are the only per-model source and may miss other machines or harnesses — though not other local ones: the `pi` and `dsh` session logs are read beside the CLI's, keeping only their `command-code*` calls.

### Development binary

`cargo build --bin cmdusedev` builds the same program under a different name, so a local build never shadows the Homebrew-installed `cmduse`. Tools that shell out can target it via `CMDUSE_BIN=/path/to/cmdusedev`. Full usage, config, and statusline docs live in **[cmduse/README.md](cmduse/README.md)**.

## Build

```sh
cargo build                      # all Rust crates
cargo test                       # core + cli (host tests)
cargo fmt --all -- --check       # formatting (CI gate)
cargo clippy --all-targets -- -D warnings
cargo package -p cmduse-core --allow-dirty   # ships plans.json+gating.json
bun install                      # every TS package (npm workspaces)
bun test                         # workspace tests, incl. opencode conformance vectors
bun run extract                  # regen core/gating.json (needs CLI)
```

Shared truth lives in `core/`: `plans.json` (plan table/caps), `gating.json` (model categories + per-plan access), `conformance.json` (behavior vectors). `core/build.rs` bakes plans/gating into Rust consts; the opencode plugin's model-gating layer imports `gating.json` and asserts the gating subset of the vectors (usage/window math is the Rust core's alone since plugin 0.2.0).

## opencode plugin

Providers (`command-code-anthropic`, `command-code-openai`), a live gated model list, `/cmd-usage` + `/ocuse-usage` + `/arkuse-usage` (TUI slash commands), and the `cmd_usage`, `mpc_prices`, `ocuse_usage` and `arkuse_usage` tools — for **both opencode v1 (≥1.18.29) and v2 (≥2.0.0)** from one package.

Requires the `cmduse` CLI (usage windows/pace rendering live in the Rust core — the plugin spawns it):

```sh
brew install JeffreyJYZ/tap/cmduse
```

The `cmd_usage` tool spawns `cmduse`; the `mpc_prices` tool (per-model price comparison across the Command Code and OpenCode Go plans) spawns `mpc`:

```sh
bun add -g @jeffreyjyz/mpc
```

Install (opencode v2 uses `plugins`; v1's singular `plugin` is auto-normalized):

```json
{
  "plugins": ["@jeffreyjyz/opencode-command-code"]
}
```

Auth, in host order: opencode's own connection — **`/connect` and pick "Command Code"** (or the `CMD_API_KEY` env method) — then our fallback `~/.commandcode/auth.json` from `cmd login`. With no credential at all the providers stay `activation: "auto"`, so a later `/connect` lights them up without a restart.

### Sidebar

Vision models (Claude, Gemini, GPT, Qwen, the DeepSeek `-vision-` ones) accept image attachments; text-only models do not. The per-model list is generated from Command Code's own CLI table — the listing API publishes no capabilities.

While a session uses a `command-code*`, OpenCode Go/Zen, or Volcengine ARK model, the session sidebar grows a section (toggle with `ctrl+x b`):

- plan, price and monthly credits used
- 5-hour and weekly windows: used / cap, percent used and elapsed, reset countdown; when the current burn rate would reach the cap before the reset it says `cap in …` instead of the elapsed share, and an over-cap window is flagged `LIMIT EXCEEDED` (both new in 0.3.12)
- this period's requests and spend
- the active model: tier, monthly allowance, $/M rates on one line (in/out plus cache read, and cache write when the model has one), Intelligence, Tok/s (new in 0.2.5)
- the cheapest plan that serves it (`Min plan`), from Command Code's own model table — the column their docs name as the access rule; shown only when the tier is unknown (new in 0.3.2, fallback-only since 0.3.6)
- the active model's own period usage — requests, plus spend and its share of the session when the harness records them (new in 0.2.9, spend share in 0.3.15; labelled `Usage (this model)`)
- a running promotion on the active model (`Deal`: badge plus expiry, new in 0.3.14)
- this session's own totals (`Session`), so mid-conversation you see what the conversation has cost rather than only the period-to-date figure (new in 0.3.12)
- on OpenCode Go/Zen sessions: the same shape from `ocuse` — the three windows come from **OpenCode Go's own usage endpoint** (the numbers `opencode.ai/console` shows: the 5-hour `rolling` block, the Monday-anchored week, the billing month, each with the server's reset), and the per-model spend, `Usage (this model)` and `Session` figures come from opencode's own store, plus rates and benchmarks from mpc's OpenCode side (new in 0.3.12). The allowance shown is the **selected Go plan**'s limit: Go and Go Plus share token prices but grant different per-model limits, and the endpoint reports percentages rather than a plan id, so set it (below). A free/unbounded model reads `Allowance: ∞` rather than a money figure. With no Go key, no network, or `--no-api`, the windows fall back to the local estimate — each window's share of the model's per-model allowance (5h 20%, weekly 50%, monthly 100%), with the 5-hour/Weekly reset derived from the oldest request still inside the window — and the panel then shows money rows rather than the account's shares.
- on Volcengine ARK Agent Plan sessions: plan + tier, then the plan's own 5-hour / weekly / monthly meters (plus a daily one when the plan has it) — used / quota, the console's share, the reset and the pace — each with this store's AFP for the same window on its continuation line, then the period's requests and AFP with the yuan equivalent, and the active model's AFP, request count and share of the period. Everything is measured in **AFP** (`1 AFP = ¥0.002`), not dollars; source is `arkuse` through `arkcli`, so the meters carry every machine and harness on the plan. With no `arkcli` (or `--no-api`) the windows fall back to this store's AFP alone and name why the plan's numbers are missing. Snapshotted for a minute because each run is a control-plane round trip (new in 0.5.18).

Usage comes from the `cmduse` CLI (polled every 5s); the model catalog comes from `mpc --json`, cached for 1h and re-read on every poll, so a new model or promotion reaches a running panel — install it with `bun link` in the `oc-cmd-compare` package, or the section keeps the model name and the store-backed rows and simply omits the catalog rows (tier, rates, allowance). The model's own usage is read from opencode's message store (`~/.local/share/opencode/opencode.db`, read-only); CommandCode is subscription-billed, so spend appears only when the harness priced the turns (a free or unpriced model keeps requests only). Models from any other provider show nothing.

All blocks remember their last reading, so a remount or a session switch repaints instead of blanking while the next poll runs. The per-model figure is keyed by model, so switching models shows that model's own row (or nothing yet) rather than the previous model's numbers. A network outage is handled the same way: `cmduse -1 --json` exits 0 even with the account API unreachable, carrying an `error` and the defaults ("Free", no windows) — the panel detects that and keeps the last good reading instead of flickering, and the model block keeps its last catalog so the model part does not vanish while `mpc` is unreachable (new in 0.3.18).

The section is plain text unless you ask for colour. To turn it on, write `~/.config/opencode/command-code.json`:

```json
{ "colors": true, "ocPlan": "go-plus" }
```

`CMD_COLORS=1` (or `0`) overrides colour for a single run; `ocPlan` is the OpenCode Go plan the panel reads per-model limits from — `go` (default) or `go-plus`, since the two share token prices but grant different limits and nothing local records which one you have (`CMD_OC_PLAN=go|go-plus` overrides it per run). An unknown plan falls back to `go` with a warning. The file is re-read every few seconds, so flipping it lands on the next poll without a restart.

opencode is told each model's published $/1M rates, so its own cost display (and any accounting built on it) works for CommandCode models instead of showing $0.

For the fastest startup, pin the plugin to an exact version in `opencode.json`:

```json
{ "plugins": ["@jeffreyjyz/opencode-command-code@<version>"] }
```

A bare name makes opencode re-resolve `@latest` (a registry round-trip) on every start; a pinned specifier is cached as-is, and the plugin's own provider is versioned with it. Take `<version>` from `npm view @jeffreyjyz/opencode-command-code version` — never copy a number into this page.

## OpenCode Go/Zen usage (`ocuse`)

`ocuse` tracks what you actually ran on **OpenCode Go** (the Go subscription) and **OpenCode Zen** (pay-as-you-go), using the same CLI shape as `cmduse`:

```sh
ocuse                 # watch: live frame (colour, gauges, spend-burst sparkline)
ocuse -1              # one-shot dashboard
ocuse --json
ocuse daily|hourly|session
ocuse model [id]
ocuse plans           # the docs catalogue: both plans' limits and rates
ocuse statusline
ocuse mcp             # MCP stdio server
```

Two differences from `cmduse` are worth knowing up front, both from upstream:

- **Go has a usage API, and `ocuse` reads it.** `GET https://opencode.ai/zen/go/v1/usage` (the credential `/connect` stored, or `OCUSE_API_KEY`/`OPENCODE_API_KEY`) answers the console's three meters — `rolling` (5-hour), `weekly` and `monthly`, each a percent and a reset instant. Those are the only window figures that agree with `opencode.ai/console`, because the server's windows are not local ones: its 5-hour window is a block with its own reset, its week is anchored to Monday 00:00 UTC, its month is the subscription anniversary, and it meters with its own price basis. Everything else — per-model totals, `daily`/`hourly`, the model table — comes from local usage: opencode.db, which records `cost`, tokens and the model for every request, for both providers, plus the `pi` and `dsh` session logs on the same providers, so the totals are not opencode's alone (the header names each client it read). With no key, no network, or `--no-api`, the windows fall back to a **local estimate** and the dashboard says so.
- **Go's allowance is per model**, not per account: each model has a monthly dollar limit, with windows of 5h = 20%, weekly = 50%, monthly = 100%. The dashboard shows each model against its own limit, and the header's window lines sum the caps of the models you used. Go ships **two plans** — Go ($10/mo) and Go Plus ($40/mo) — with the same token prices but different per-model limits; nothing local records which one you have (the subscription lives in the console, and the usage endpoint reports percentages rather than a plan id), so select it with `--plan go|go-plus` (default `go`).

The monthly *period* comes from the endpoint's own reset instant when it answers (the billing anniversary, which is why the dashboard reads `Go billing month`); without it the default is the calendar month, `--period-start YYYY-MM-DD` pins a real one and `--window all|<n>d` reports other ranges (inference from your first Go request exists behind `--infer-anniversary`, but it guesses wrong on sparse history).

Limits and rates come from `core/zen.json`, regenerated with `bun scripts/extract-zen.ts` from OpenCode's own docs sources.

The watch frame is `cmduse`'s: the same palette, severity-coloured gauges (green <70%, yellow 70–90%, red ≥90%), an over-cap window flagged `LIMIT EXCEEDED`, and in-place redraw, so resizing or a shrinking frame never scrolls. A model over any of its own windows carries the same flag beside its name — Go meters per model *and* per window, so being over the 5-hour cap counts like being over the month — and every row ends with that model's share of the period's spend. A spend-burst sparkline appears once the 5-hour window moves between refreshes (delta spend, not the cumulative figure — that only ever rises). Every subcommand colours the same way — `daily`, `hourly`, `session`, `model`, `plans` and `statusline` included, with secondary text dimmed and figures in cyan. `--plain`, `NO_COLOR` and a piped stdout drop the colour and the gauges, so scripted output stays escape-free.

## Volcengine ARK Agent Plan usage (`arkuse`)

`arkuse` tracks a **Volcengine ARK Agent Plan** with the same CLI shape, in the plan's own unit — **AFP**, not dollars:

```sh
arkuse                # watch: live frame (plan meters, gauges, model block)
arkuse -1             # one-shot dashboard
arkuse --json
arkuse daily|hourly|session
arkuse model [id]
arkuse plans          # personal tiers, AFP quotas, window shares, promos
arkuse models         # catalogue with the coefficient in force today
arkuse statusline
arkuse mcp            # MCP stdio server
```

Two differences from `cmduse` are worth knowing up front, both from upstream:

- **ARK meters in AFP, and the plan is the unit that has limits.** `AFP = (input + cache_read + output) × coefficient / 10,000`, one AFP is ¥0.002 at every tier; cache reads are billed, and `reasoning` is not counted twice because it already sits inside the output tokens. Coefficients, tier gates and the promo dates that halve them live in `core/ark.json` — the publisher documents them as prose, so there is no machine-readable catalogue to extract.
- **The plan's own meters are the only account-wide view.** `arkcli usage plan --profile <name>` returns the 5-hour / daily / weekly / monthly meters with their resets — figures that see every machine and harness on the subscription. Local usage (`opencode.db`, provider `agent-plan` only, plus `pi` and `dsh` logs filtered the same way) supplies per-model attribution; where both exist the meter owns the window row and this store's AFP is printed beside it labelled `local`. Without a profile, `arkcli`, or with `--no-api`, the windows are a **local estimate** and say so — measured against the plan's published split (5-hour 10%, daily 50%, weekly 35%, monthly 100%) so each row still reads `used / quota`, a percentage and a countdown instead of AFP alone. The server's windows are not reproducible locally — the 5-hour window is a block with its own reset, the week starts Monday 00:00, the month is the subscription anniversary — so rows are cut at `reset − window`, never a rolling `now − window`, and dates print in the server's offset. A meter served without figures (a just-reset block carries only `total` and `percent`) is derived, never rejected.

A text-only workload has **no daily window** (only media and Harness items do), so that row simply does not appear. `--plan small|medium|large|max` picks the ARK tier (default: the profile's own `plan_tier`, else `medium`) and `--profile <name>` picks the `arkcli` profile (default `$ARKUSE_PROFILE`, else the first `agent-plan` profile); `arkuse plans` lists the personal tiers with their AFP quotas, the enterprise seat prices (their AFP is metered per seat and the personal API does not expose it), and the plan's rules: no downgrade, monthly quota pro-rated on upgrade while the 5-hour and weekly windows reset immediately, and plain API calls against the plan base URL forbidden.

ARK limits the plan rather than a model, so the cap notification fires per window meter and the model block shows each model's share of period AFP instead of an allowance ARK does not have. The watch frame is `cmduse`'s: same palette, same severity gauges, same in-place redraw and spend-burst sparkline.

## MCP server

`cmduse mcp` runs an MCP stdio server (hand-rolled JSON-RPC, no extra deps) exposing seven tools: `usage` (dashboard), `plans` (comparison table), `models` (live gated list), `daily`, `hourly`, `session` (by project) and `model` (by model) — the same output the CLI subcommands print, with auth and `~/.commandcode/auth.json` shared.

Zed (`~/.config/zed/settings.json`):

```json
{
  "context_servers": {
    "cmduse": { "source": "custom", "command": "cmduse", "args": ["mcp"] }
  }
}
```

Any other MCP host: run `cmduse mcp` as a stdio server. The opencode plugin doesn't need it — it registers its own providers and spawns `cmduse` directly.

## License

MIT — each package ships its own: [cmduse/LICENSE-MIT](cmduse/LICENSE-MIT), [core/LICENSE-MIT](core/LICENSE-MIT), and a `LICENSE` in every TypeScript package (`opencode-plugin`, `oc-cmd-compare`, `reqshape`, `opencode-context`, `opencode-shell-rc`, `opencode-session-dir`).
