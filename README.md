# Command Code tooling

[![CI](https://github.com/JeffreyJYZ/command-code-zed/actions/workflows/ci.yml/badge.svg)](https://github.com/JeffreyJYZ/command-code-zed/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/cmd-usage.svg)](https://crates.io/crates/cmd-usage)
[![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-command-code.svg)](https://www.npmjs.com/package/@jeffreyjyz/opencode-command-code)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

Everything Command Code (commandcode.ai) usage: a terminal dashboard with a
built-in MCP server, and an opencode provider. One Cargo workspace shares the
plan table and window math via `cmduse-core`; the opencode plugin is a
separate TS package that registers the providers and delegates usage
rendering to the `cmduse` CLI.

## Components

| Component | Crate / dir | Install | Docs |
|---|---|---|---|
| `cmduse` CLI | `cli/` (crate `cmd-usage`, bin `cmduse`) | [crates.io](https://crates.io/crates/cmd-usage) · [brew](https://github.com/JeffreyJYZ/homebrew-tap) | **[cli/README.md](cli/README.md)** · [man page](cli/cmduse.1) |
| `ocuse` (same crate) | `cli/` (bin `ocuse`) | same crate as `cmduse` | OpenCode Go/Zen usage from local data — see below |
| Shared core | `core/` (crate `cmduse-core`) | [crates.io](https://crates.io/crates/cmduse-core) | [docs.rs/cmduse-core](https://docs.rs/cmduse-core) · versioned on its own `2.x` line, not as a pair with the CLI |
| opencode plugin | `opencode/` (`@jeffreyjyz/opencode-command-code`) | [npm](https://www.npmjs.com/package/@jeffreyjyz/opencode-command-code) | [opencode/src/index.ts](opencode/src/index.ts) |

## Install the CLI

```sh
brew install JeffreyJYZ/tap/cmduse     # macOS + Linux, prebuilt binary (no cargo)
cargo binstall cmd-usage               # any platform, prebuilt from the release
cargo install cmd-usage                # build from source (any platform)
```

Then run `cmduse` for the live dashboard, or `cmduse plans` / `cmduse models`.

`cmduse model [--days N | --since ISO] [--json]` reports local per-model usage; without a window it
is all-time, so pass one when you mean a billing period. `--json` includes `source` and `since`.
There is no account-side per-model endpoint (the API only exposes totals), so local logs are the
only per-model source and may miss other machines or harnesses.

### Development binary

`cargo build --bin cmdusedev` builds the same program under a different name, so a local build
never shadows the Homebrew-installed `cmduse`. Tools that shell out can target it via
`CMDUSE_BIN=/path/to/cmdusedev`.
Full usage, config, and statusline docs live in **[cli/README.md](cli/README.md)**.

## Build

```sh
cargo build                      # all Rust crates
cargo test                       # core + cli (host tests)
cargo fmt --all -- --check       # formatting (CI gate)
cargo clippy --all-targets -- -D warnings
cargo package -p cmduse-core --allow-dirty   # ships plans.json+gating.json
cd opencode && bun install && bun test       # conformance vectors too
bun run extract                              # regen core/gating.json (needs CLI)
```

Shared truth lives in `core/`: `plans.json` (plan table/caps), `gating.json`
(model categories + per-plan access), `conformance.json` (behavior vectors).
`core/build.rs` bakes plans/gating into Rust consts; the opencode plugin's
model-gating layer imports `gating.json` and asserts the gating subset of the
vectors (usage/window math is the Rust core's alone since plugin 0.2.0).

## opencode plugin

Providers (`command-code-anthropic`, `command-code-openai`), a live gated
model list, `/usage` (TUI slash command, alias `/cmd-usage`), and the
`cmd_usage` tool — for **both opencode v1 (≥1.18.29) and v2 (≥2.0.0)** from
one package.

Requires the `cmduse` CLI (usage windows/pace rendering live in the Rust
core — the plugin spawns it):

```sh
brew install JeffreyJYZ/tap/cmduse
```

Install (opencode v2 uses `plugins`; v1's singular `plugin` is auto-normalized):

```json
{
  "plugins": ["@jeffreyjyz/opencode-command-code"]
}
```

Auth, in host order: opencode's own connection — **`/connect` and pick
"Command Code"** (or the `CMD_API_KEY` env method) — then our fallback
`~/.commandcode/auth.json` from `cmd login`. With no credential at all the
providers stay `activation: "auto"`, so a later `/connect` lights them up
without a restart.

### Sidebar

Vision models (Claude, Gemini, GPT, Qwen, the DeepSeek `-vision-` ones) accept image attachments;
text-only models do not. The per-model list is generated from Command Code's own CLI table — the
listing API publishes no capabilities.

While a session uses a `command-code*` model — or an OpenCode Go/Zen one — the session sidebar
grows a section (toggle with `ctrl+x b`):

- plan, price and monthly credits used
- 5-hour and weekly windows: used / cap, percent used and elapsed, reset countdown; when the current
  burn rate would reach the cap before the reset it says `cap in …` instead of the elapsed share, and
  an over-cap window is flagged `LIMIT EXCEEDED` (both new in 0.3.12)
- this period's requests and spend
- the active model: tier, monthly allowance, $/M rates on one line (in/out plus cache read, and
  cache write when the model has one), Intelligence, Tok/s (new in 0.2.5)
- the cheapest plan that serves it (`Min plan`), from Command Code's own model table — the column
  their docs name as the access rule; shown only when the tier is unknown (new in 0.3.2, fallback-only
  since 0.3.6)
- the active model's own period usage — requests, plus spend when the harness records it
  (new in 0.2.9; labelled `Usage (this model)`)
- this session's own totals (`Session`), so mid-conversation you see what the conversation has cost
  rather than only the period-to-date figure (new in 0.3.12)
- on OpenCode Go/Zen sessions: the same shape from `ocuse`, the only local source for those
  providers — spend against each window's share of the model's per-model allowance (5h 20%,
  weekly 50%, monthly 100%), plus rates and benchmarks from mpc's OpenCode side (new in 0.3.12).
  Deliberately no reset countdowns there: Go has no usage API, so the only local figure is an
  approximation.

Usage comes from the `cmduse` CLI (polled every 5s); the model catalog comes from `mpc --json`,
cached for 6h — install it with `bun link` in the sibling `oc-cmd-compare` checkout, or the section
simply omits those rows. The model's own usage is read from opencode's message store
(`~/.local/share/opencode/opencode.db`, read-only); CommandCode is subscription-billed, so its
rows show requests only. Non-CommandCode models show nothing.

Both blocks remember their last reading, so a remount or a session switch repaints instead of
blanking while the next poll runs. The per-model figure is keyed by model, so switching models
shows that model's own row (or nothing yet) rather than the previous model's numbers.

The section is plain text unless you ask for colour. To turn it on, write
`~/.config/opencode/command-code.json`:

```json
{ "colors": true }
```

`CMD_COLORS=1` (or `0`) overrides the file for a single run. The file is re-read every few seconds,
so flipping it lands on the next poll without a restart.

opencode is told each model's published $/1M rates, so its own cost display (and any accounting
built on it) works for CommandCode models instead of showing $0.

For the fastest startup, pin the plugin to an exact version in `opencode.json`:

```json
{ "plugins": ["@jeffreyjyz/opencode-command-code@0.3.4"] }
```

A bare name makes opencode re-resolve `@latest` (a registry round-trip) on every start; a pinned
specifier is cached as-is, and the plugin's own provider is versioned with it.

## OpenCode Go/Zen usage (`ocuse`)

`ocuse` tracks what you actually ran on **OpenCode Go** (the $10/mo subscription) and
**OpenCode Zen** (pay-as-you-go), using the same CLI shape as `cmduse`:

```sh
ocuse                 # watch: live frame (colour, gauges, spend-burst sparkline)
ocuse -1              # one-shot dashboard
ocuse --json
ocuse daily|hourly|session
ocuse model [id]
ocuse plans           # the docs catalogue: limits and rates
ocuse statusline
ocuse mcp             # MCP stdio server
```

Two differences from `cmduse` are worth knowing up front, both from upstream:

- **OpenCode publishes no usage API.** The console tracks usage; the one API route
  (`/zen/go/v1/usage`) answers `EntitlementError` for keys without a Go subscription, and
  Zen has no equivalent at all. So `ocuse` reports your **local** usage — opencode.db, which
  records `cost`, tokens and the model for every request, for both providers.
- **Go's allowance is per model**, not per account: each model has a monthly dollar limit,
  with windows of 5h = 20%, weekly = 50%, monthly = 100%. The dashboard shows each model
  against its own limit, and the header's window lines sum the caps of the models you used.

The monthly *period* has no local record (renewals are in the console), so the default is the
calendar month; `--period-start YYYY-MM-DD` pins the real one and `--window all|<n>d` reports
other ranges (inference from your first Go request exists behind `--infer-anniversary`, but it
guesses wrong on sparse history).

Limits and rates come from `core/zen.json`, regenerated with `bun scripts/extract-zen.ts` from
OpenCode's own docs sources.

The watch frame is `cmduse`'s: the same palette, severity-coloured gauges (green <70%,
yellow 70–90%, red ≥90%), an over-cap window flagged `LIMIT EXCEEDED`, and in-place redraw,
so resizing or a shrinking frame never scrolls. A model over any of its own windows carries
the same flag beside its name — Go meters per model *and* per window, so being over the
5-hour cap counts like being over the month — and every row ends with that model's share of
the period's spend. A spend-burst sparkline appears once the 5-hour window moves between
refreshes (delta spend, not the cumulative figure — that only ever rises). Every subcommand
colours the same way — `daily`, `hourly`, `session`, `model`, `plans` and `statusline`
included, with secondary text dimmed and figures in cyan. `--plain`, `NO_COLOR` and a piped
stdout drop the colour and the gauges, so scripted output stays escape-free.

## MCP server

`cmduse mcp` runs an MCP stdio server (hand-rolled JSON-RPC, no extra deps)
exposing five tools: `usage` (dashboard), `plans` (comparison table),
`models` (live gated list), `daily`, and `hourly` — the same output the CLI
subcommands print, with auth and `~/.commandcode/auth.json` shared.

Zed (`~/.config/zed/settings.json`):

```json
{
  "context_servers": {
    "cmduse": { "source": "custom", "command": "cmduse", "args": ["mcp"] }
  }
}
```

Any other MCP host: run `cmduse mcp` as a stdio server. The opencode plugin
doesn't need it — it registers its own providers and spawns `cmduse` directly.

## Why the split

0.1.x duplicated pure logic across two Rust crates (e.g. the burn-rate pace
gate was patched in two files for one bug). The workspace moves all shared
math into `core/`; `cli/` keeps only its presentation + I/O. The Zed
extension (deprecated 0.6.9) was replaced by the built-in MCP server — one
integration serves every MCP-capable host instead of one hand-maintained
WASM product per editor.

## License

MIT — see [cli/LICENSE-MIT](cli/LICENSE-MIT), [core/LICENSE-MIT](core/LICENSE-MIT), and [opencode/LICENSE](opencode/LICENSE).
