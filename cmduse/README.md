# cmduse

Live Command Code usage dashboard for your terminal.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml) [![crates.io](https://img.shields.io/crates/v/cmd-usage?style=flat-square)](https://crates.io/crates/cmd-usage) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE-MIT)

## What it is

Plan dashboard, account-wide usage reports (all harnesses), offline local reports, and a customisable statusline.

## Install

```sh
brew install JeffreyJYZ/tap/cmduse   # macOS (Homebrew)
cargo install cmd-usage              # any platform with Rust
```

## Quick start

```text
Command Code Usage · GOAT · active
Period ends 2026-09-27

Credits $59.12 / $70.00 monthly · $0.00 purchased · $0.00 free

Usage windows
 Monthly   15.1% ━━╱╱╱╱╱╱╱╱  $10.56 / $70.00 · resets in 22d 9h · window 28% elapsed · $19.60 by now
 5-hour     1.5% ╱╱╱╱╱╱╱╱╱╱  $0.21 / $14.00 · resets in 4h 58m · window 0% elapsed
 Weekly    15.8% ━╱╱╱╱╱╱╱╱╱  $5.54 / $35.00 · resets in 6d 5h · window 11% elapsed · on pace to hit cap in 4d 3h

This billing period
 Requests 856 · Cost $10.69 · Tokens 89.5M in / 265.7K out · Success 100% · 15.3% of credits
```

The trailing `N% of credits` is this period's cost against the plan table's
monthly cap — the one period-wide share the dashboard states, and absent on a
plan with no published cap. It is computed locally, so it keeps one decimal.

## Usage

```sh
cmduse                       # live dashboard, redraws in place (default every 5s)
cmduse -1                    # one-shot fetch, print, exit
cmduse -V                    # print version
cmduse -p -1                 # plain output, no ANSI (for scripts/pipes)
                             # same fields as the colored dashboard: period end,
                             # monthly quota, Monthly row (+ $X by now), window % elapsed
                             # (also what the MCP `usage` tool and the opencode
                             # /cmd-usage dialog render)
cmduse -i 30                 # refresh every 30s
cmduse -i 5m                 # duration suffixes: s, m, h, d
cmduse -w 40                 # 40-char progress bars (--bar-width)
cmduse -b 60                 # 60 spend-burst samples (--bursts)
cmduse -W                    # force watch mode (the default; conflicts with -1)
cmduse watch                 # explicit watch mode (same as bare cmduse)
man cmduse                   # full behavior spec (brew installs the man page)

cmduse daily --days 14       # account usage by day (all harnesses, from usage API)
                             # --days max 365, fetched 8-at-a-time
cmduse daily --local         # CLI-logs-only (offline, misses other harnesses)
cmduse daily --tz +05:30     # bucket by a fixed UTC offset instead of UTC
cmduse daily --local --tz +05:30  # ...the local-log path honors --tz too
cmduse hourly --hours 6      # account usage by hour (default 24, max 168)
cmduse hourly --local        # hourly from local CLI logs (offline)
cmduse model                 # local usage by model (all time)
cmduse model 'zai-org/GLM-5.2'   # one model's row: requests, tokens, cost, share
cmduse model --days 30       # ...only the last 30 days
cmduse model --since 2026-08-27T00:00:00Z   # ...or since a billing-period start
cmduse model --rows 10       # trim the table (0 = every row, which is the default)
cmduse session --days 30     # local usage by project, same window flags
cmduse models                # live model list from the Command Code API
cmduse models --gated        # ...only models the current plan allows
cmduse models --gated --json # every model annotated with allowed + reason
cmduse plans                 # plan comparison table (marks your plan)
cmduse statusline            # compact one-liner for prompts/tmux
cmduse mcp                   # MCP stdio server (usage/plans/models/daily/hourly/session/model tools)
cmduse daily --json          # JSON output (daily, hourly, model, session, models, statusline, plans, -1)
cmduse daily --csv           # CSV output for daily/hourly/model/session
```

Color: SGR escapes are suppressed when stdout is not a terminal or when `NO_COLOR` is set non-empty. The live dashboard's spinner goes straight to /dev/tty, so it only runs when stdout is a terminal — `--plain`, or any piped or redirected run, never writes to the terminal at all. `-p`/`--plain` is parsed globally, so every subcommand accepts it; on reports it is a no-op rather than an error, and `--json`/`--csv` remain the machine-readable paths.

## MCP server

`cmduse mcp` runs an MCP stdio server (newline-delimited JSON-RPC, hand-rolled — no extra dependencies) so any MCP-capable host (Zed, and others) can call Command Code usage as tools:

| Tool      | Body                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `usage`   | one-shot dashboard (same as `cmduse -1`)                                                                                  |
| `plans`   | plan comparison table (same as `cmduse plans`)                                                                            |
| `models`  | live model list, filtered to the current plan (same as `cmduse models --gated`); args `gated` (default true)              |
| `daily`   | account daily report; args `days`, `tz` (±HH:MM), `local`                                                                 |
| `hourly`  | account hourly report; args `hours`, `tz`, `local`                                                                        |
| `session` | local usage by project/session; args `since` (ISO-8601), `days`, `tz`, `rows`                                             |
| `model`   | local usage by model; args `since` (ISO-8601), `days`, `tz`, `rows`, and `id` for one model's detail instead of the table |

The tool _names_ are the same in all three servers, and an argument means the same thing wherever it exists. Where a source forces a difference it is stated rather than papered over: `ocuse` and `arkuse` add `plan` (the plan their source cannot report), and their `session`/`model` carry no `tz` — their store is already bucketed in the offset the server reports — while `cmduse`'s `session`/`model` do take `tz` and their `daily`/`hourly` additionally take `local`. Tests pin each server's own list.

Auth is the same as the CLI (`CMD_API_KEY`, then `~/.commandcode/auth.json`). Tool errors come back as `isError: true` results; stdout carries protocol traffic only. Zed config:

```json
{
	"context_servers": {
		"cmduse": { "source": "custom", "command": "cmduse", "args": ["mcp"] }
	}
}
```

`-1 --json` emits a single dashboard object (plan, credits, both windows, billing summary, `source`, and the period bounds `periodStart`/`periodStartAt`/`periodEndAt` in epoch ms beside the display date `periodEnd`). `statusline --json` uses the family's window names — `fiveHourSpent`/`fiveHourCap`, `weeklySpent`/`weeklyCap`, `monthSpent`/`monthCap` — with the older `fiveHourUsed`/`weeklyUsed`/`monthlyRemaining` still emitted as aliases. `--gated --json` on `models` emits every model with `allowed` and `reason` instead of filtering.

GNU forms are accepted: `--interval=5m`, `--days=14`, and attached short values like `-i30` / `-w40`. `--last`/`-l` are aliases for `--days`.

Cap alerts: in watch mode a desktop notification fires once when a window crosses into overflow (macOS `osascript`, Linux `notify-send`). Disable with `cmduse config set notify=false`.

Burn-rate: windows show `on pace to hit cap in …` when the current spend rate projects hitting the cap before the window resets, and only once the window is ≥10% elapsed (flat-rate projection is unreliable early). ponytail: assumes flat spend rate; bursty sessions shift the ETA.

Watch mode: a `spend bursts (N samples)` sparkline shows $ spent per refresh. It is on by default, hidden while idle (all-zero deltas), and its sample count is configurable. Session-only: a fresh run starts a fresh trend (no stale data from earlier runs):

```sh
cmduse config set burst_on=false      # turn the sparkline off
cmduse config set burst=80            # 80 samples (5–240)
cmduse -b 120                         # same for one run
```

## Statusline

Template-driven via config. Placeholders:

| Placeholder                                             | Shows                                            |
| ------------------------------------------------------- | ------------------------------------------------ |
| `{plan}`                                                | plan name (GOAT, Pro, …)                         |
| `{credits}`                                             | remaining monthly credits                        |
| `{cap}`                                                 | monthly cap                                      |
| `{credits_bar}`                                         | monthly usage bar                                |
| `{5h_bar}` `{5h_pct}` `{5h_used}` `{5h_cap}` `{5h_eta}` | 5-hour window (eta = pace text, empty when none) |
| `{wk_bar}` `{wk_pct}` `{wk_used}` `{wk_cap}` `{wk_eta}` | weekly window                                    |

```sh
cmduse config set sl="{plan} {credits}/{cap} 5h:{5h_pct} wk:{wk_pct}"
cmduse config set sl="{credits_bar}"           # just one bar
cmduse config set sl_colors=false              # strip ANSI
cmduse config set sl_ascii=true                # #--- bars instead of ━╱╱
```

Multi-line templates work (newlines allowed). Unknown placeholders are dropped. Wire into your shell prompt or tmux status:

```sh
# .zshrc / tmux status-right
status() { cmduse statusline 2>/dev/null; }
```

`CMD_API_KEY` env var overrides the stored key — point `cmduse` at any account without touching `~/.commandcode/auth.json`.

## Config

`~/.config/cmd-usage/config.json`:

```json
{
	"interval_secs": 5,
	"bar_width": 20,
	"burst_enabled": true,
	"burst_samples": 40,
	"notify_on_cap": true,
	"statusline_template": "{plan} {credits}/{cap} · 5h {5h_bar} · wk {wk_bar}",
	"statusline_colors": true,
	"statusline_ascii": false,
	"check_updates": true,
	"dismissed_update": null
}
```

CLI flags override config. `cmduse config set interval=<s> width=<n> burst_on=<bool> burst=<n> notify=<bool> sl=<tpl> sl_colors=<bool> sl_ascii=<bool> update_check=<bool> dismissed_update=<ver>`.

## Updates

Once per day (cache at `~/.cache/cmd-usage/last-check`) the dashboard checks crates.io; when a newer `cmd-usage` exists it shows a boxed notice inside the watch frame (stderr for `-1`). The cached version is replayed every run, so the reminder persists until you upgrade. Dismiss or disable:

```sh
cmduse --dismiss-update              # hide this version until a newer one
cmduse config set update_check=false # never check
cmduse config set dismissed_update=<ver>
```

## Data sources

- **Dashboard / daily / hourly / statusline**: Command Code API with your account key. Daily and hourly cover **every harness** that used the key (CLI, Provider API, other agents). With no key to resolve, `daily` falls back to the local CLI logs — the same data `--local` gives — rather than failing.
- **model / session / daily --local**: local session logs at `~/.commandcode/projects` — offline, but only what the CLI recorded. The `pi` and `dsh` session logs are read too, counting only their calls on a `command-code*` provider, so a harness other than the CLI still shows up (their roots are `~/.pi/agent/sessions` and `~/.dsh/sessions`, override with `PI_SESSIONS_DIR` / `DSH_SESSIONS_DIR`). `model`/`session` are all-time unless given `--days N` or `--since <ISO>`; the usage API has no per-model split, so local logs are the only per-model source. `--rows N` trims a table (`0` = every row); it never touches `--json`/`--csv`, which always carry every row.

## Requirements

Logged-in [Command Code CLI](https://commandcode.ai) — reads your API key from `~/.commandcode/auth.json` (run `cmd login` if missing), or set `CMD_API_KEY`.

## How it works

### ocuse — OpenCode Go/Zen (same crate, second binary)

The same crate ships `ocuse`, which tracks **OpenCode Go** (the Go subscription) and **OpenCode Zen** (pay-as-you-go) at full command/flag parity with `cmduse` — same subcommands, same `--json`/`--csv`, same config keys, same update check and cap notification. The two share one front-end (`cli.rs` parses both binaries' argv, `config.rs` owns both config files) and `cmduse`'s render/watch/sparkline helpers; only the data source and the flags it forces differ (`--plan`/`--window`/`--period-start`/`--infer-anniversary`/`--db`/`--no-api` are ocuse-only, `--local` is cmduse-only).

```sh
ocuse                        # watch: live frame (colour, gauges, spend-burst sparkline)
ocuse -1                     # one-shot dashboard
ocuse -1 --json              # one-shot, machine-readable
ocuse daily [--days N] [--json|--csv] [--tz ±HH:MM]
ocuse hourly [--hours N] [--json|--csv] [--tz ±HH:MM]
ocuse model [id] [--since ISO] [--json|--csv]
ocuse session [--since ISO] [--json|--csv]
ocuse models [--gated] [--json]   # the Go catalogue for the selected plan
ocuse plans [--json]              # both plans' limits, rates and window shares
ocuse statusline [--json]         # compact one-liner, or its numbers as JSON
ocuse mcp                    # MCP stdio server (usage/plans/models/daily/hourly/session/model)
```

Two upstream facts shape it: OpenCode Go **does** have a usage API (the console's own source), and Go's allowance is **per model** — each model has a monthly dollar limit with windows of 5h = 20%, weekly = 50%, monthly = 100%. So `ocuse` reads **`GET https://opencode.ai/zen/go/v1/usage`** with the Go key (`OCUSE_API_KEY`, `OPENCODE_API_KEY`, else the live credential opencode itself is using — `credential` in `opencode.db`, which is where v2 and `/connect` write it, with the legacy `~/.local/share/opencode/auth.json` as the fallback for a v1 install) for the three account meters — `rolling` (5-hour), `weekly`, `monthly`, each a percent and a reset instant, exactly what `opencode.ai/console` prints — and reports its own local usage from `opencode.db` (providers `opencode-go` and `opencode`, which record real `cost`) against the limits in `core/zen.json` (regenerated with `bun scripts/extract-zen.ts`) for everything the endpoint cannot give: the per-model table, `daily`/`hourly`/`session`, tokens. The endpoint's figures win wherever both exist, because the server's windows are not reproducible locally: its 5-hour window is a _block_ that resets at its own instant, its week is anchored to Monday 00:00 UTC, its month is the subscription anniversary, and it meters with its own price basis (fitted from real rows, opencode's recorded `cost` sits below it). The local half is not opencode's store alone: `pi` (`~/.pi/agent/sessions`) and `dsh` (`~/.dsh/sessions`, zstd-compressed) run on `opencode-go` too and record a provider, model and token count per call, so their rows are read and counted, and the header names every client it read (`from …/opencode.db + pi, dsh`); both are opt-out-free and additive — override the roots with `PI_SESSIONS_DIR` / `DSH_SESSIONS_DIR`, and `--json` carries the list as `clients`. No key, no network, or `--no-api` leaves the windows as a **local estimate**, and the dashboard labels them that way. Go comes in **two plans** — Go ($10/mo) and Go Plus ($40/mo) — that share the token prices but grant different per-model limits; neither the store nor the endpoint names your plan, so `ocuse` selects it with `--plan go|go-plus` (default `go`). `ocuse models` lists that catalogue for the plan (`--gated` keeps only the models the plan grants); `ocuse models --json` is one object per line, like `cmduse models --json`.

The billing period comes from the endpoint's own monthly reset instant (the anniversary — hence the dashboard's `Go billing month` label); without it the default is the calendar month, `--period-start YYYY-MM-DD` pins a real one, `--window all|<n>d` reports other ranges, `--since <ISO-8601>` pins an exact instant for `model`/`session`, and `--tz` shifts day/hour buckets. `--days` (default 120; `-l` and `--last` are aliases) bounds the read window; `hourly` uses `--hours` (default 24, max 168). `ocuse -1 --json` carries the period bounds in epoch milliseconds — `periodStart` (with the alias `periodStartAt`) and `periodEndAt`, the resolved end of the period (`null` for `--window all`, whose range has no boundary), whose display date is `periodEnd` — plus `summary`, the period's own aggregate (`{cost, requests, tokens}`, the same figures as `totals.month`), the per-model `models`, an `account` object with the three meters (`{status, percent, resetsAt}` each, `null` when the endpoint did not answer) and an `accountError` string naming why it is null when that is worth saying (`HTTP 401 api_key_expired`, `no Go key`, a transport fault — `null` when the endpoint answered, and for `--no-api`, where the missing meters are a deliberate choice). The dashboard prints that reason under the `GO` heading, because "estimated locally" on its own cannot tell a missing key from an expired one, and only the expired one is something to act on (re-login does not renew it: create a new key in the OpenCode console). The dashboard names that end date on its `period:` line, splits period tokens `in / out`, and — when the endpoint answered — ends the line with the account's monthly share (`N% of limit`), mirroring cmduse. cmduse's `Success N%` is absent: opencode's own store records no per-request success/error signal.

`ocuse` renders with `cmduse`'s own presentation: the same palette, the same severity-coloured gauges (green &lt;70%, yellow 70–90%, red ≥90%), the same in-place watch redraw (`cmduse`'s `redraw_frame`, so a shrinking frame never scrolls), and the same spend-burst sparkline. Both watch loop and gauges reuse `cmduse/src/render.rs` rather than a second copy. Every subcommand takes the colour flag — `daily`, `hourly`, `session`, `model`, `models`, `plans` and `statusline` included (bold headings, dim secondary text, cyan figures, an over-cap window _or_ model flagged `LIMIT EXCEEDED`, and a `TOP 3 MODELS` block stating each of the period's biggest models' spend and share of period spend beside its tokens and share of all tokens). With the account meters in play each window row carries this store's own spend beside the server's share of the limit (`$28.00 · 55% of limit`), priced on the documented peak/off-peak schedule — opencode records the off-peak sheet for every turn, so its recorded cost reads ~40% under the console on peak-heavy days and is not what the rows use — keeping the elapsed share measured against the server's own resets, an `on pace to hit cap in …` ETA, and the monthly window's `$X by now` pro-rata figure. No dollar denominator is printed: the console meters at roughly twice the cost opencode records, so any ceiling derived from one side contradicts the other — `spend / share` offered `$40` against a documented `$80` monthly allowance, and the summed per-model limits were the old `$215`. Each model's own limit, and its spend against it, stay in the table below. The _per-model_ `5H`/`WK` columns in the table stay local rolling windows and the dashboard says so. `statusline`'s `{five_hour_pct}`/`{weekly_pct}`/`{month_pct}` (and their `_bar` forms) resolve to the account's shares when it answers and to a dash without it, while money placeholders stay local. `--plain`, `NO_COLOR` and a piped stdout drop colour and gauges; scripted output stays escape-free, and `--json`/`--csv` are never coloured.

Config lives at `~/.config/ocuse/config.json` with the same keys as cmduse's: `interval_secs`, `bar_width`, `burst_enabled`, `burst_samples`, `notify_on_cap`, `statusline_template`, `statusline_colors`, `statusline_ascii`, `check_updates`, `dismissed_update`. The live frame refreshes every **5s**, like `cmduse`'s — `interval_secs` (or `-i`) is the knob. Set with `ocuse config set interval=<s> width=<n> burst_on=<bool> burst=<n> notify=<bool> sl=<tpl> sl_colors=<bool> sl_ascii=<bool> update_check=<bool> dismissed_update=<ver>`. The statusline template placeholders: `{plan}` `{period}` `{month}` `{month_pct}` `{month_bar}` `{five_hour}` `{five_hour_pct}` `{five_hour_bar}` (aliases `{5h}` `{5h_pct}` `{5h_bar}`), `{weekly}` `{weekly_pct}` `{weekly_bar}` (aliases `{wk}` `{wk_pct}` `{wk_bar}`), and `{models}` (top model by period spend).

### arkuse — Volcengine ARK Agent Plan (same crate, third binary)

The same crate ships `arkuse`, which tracks a **Volcengine ARK Agent Plan** at the same command/flag parity as `cmduse` and `ocuse` — every subcommand, `--json`/`--csv`, the same watch frame, config keys, update check, cap notification and MCP server. ARK is metered in **AFP**, the plan's own unit, not in dollars: `AFP = (input + cache_read + output) × coefficient / 10,000`, one AFP is ¥0.002 at every tier. Cache reads are billed, and `reasoning` is _not_ added again because it already sits inside `output`. Model coefficients, tier gates and the promo dates that halve them live in hand-maintained `core/ark.json` (the publisher documents them as prose, so there is no machine-readable source to extract from).

```sh
arkuse                       # watch: live frame (meters, gauges, model block)
arkuse -1                    # one-shot dashboard
arkuse -1 --json             # one-shot, machine-readable
arkuse daily [--days N] [--json|--csv] [--tz ±HH:MM]
arkuse hourly [--hours N] [--json|--csv] [--tz ±HH:MM]
arkuse model [id] [--since ISO] [--json|--csv]
arkuse session [--since ISO] [--json|--csv]
arkuse models [--gated] [--json]   # the ARK catalogue, coefficient in force today
arkuse plans [--json]              # personal tiers, AFP quotas, window shares
arkuse statusline [--json]
arkuse mcp                   # MCP stdio server (usage/plans/models/daily/hourly/session/model)
```

Two sources, and the split matters. The **control plane** (`arkcli usage plan --profile <name>`, which `arkuse` shells out to so `arkcli` keeps owning the credential chain) returns the plan's own 5-hour / daily / weekly / monthly meters with their reset instants — the only figures that see every machine and every harness on the subscription. This store (`opencode.db`, provider `agent-plan` only) supplies the per-model attribution and the local estimate; `pi` and `dsh` session logs are read too, and only their `agent-plan` rows count, so the local half covers every client on this machine rather than opencode alone. Where both exist the meter wins for the window rows and the local AFP is printed beside it, labelled `local`; with no profile, no `arkcli`, or `--no-api`, the windows fall back to a rolling cut and say `estimated locally` — still as `used / quota` against the plan's published split (5-hour 10%, daily 50%, weekly 35%, monthly 100% of its AFP), so a window never degrades to AFP alone. The server's windows are not reproducible locally: the 5-hour window is a _block_ with its own reset, the week is anchored to Monday 00:00, and the month is the subscription anniversary — so `arkuse` cuts this store's rows at `reset − window` rather than a rolling `now − window`, and prints dates in the server's own offset. A window the control plane reports without figures (a just-reset block comes back as `total` + `percent` only) is derived rather than rejected, and its countdown falls back to the oldest row still inside the cut. A text-only workload has **no daily window** (only media/Harness items do), so that row simply does not appear.

`--plan small|medium|large|max` selects the ARK tier (default: the profile's own `plan_tier`, else `medium`); `--profile <name>` names the `arkcli` profile (default `$ARKUSE_PROFILE`, else the first `agent-plan` profile), and `--db` overrides the store. The billing period comes from the meter's monthly reset; without it the default is the calendar month, with `--period-start`, `--window all|<n>d` and `--since` as in `ocuse`. `--no-api` skips `arkcli` entirely, so the tier then comes from `--plan` (or the catalogue default) and no profile is resolved.

ARK limits the **plan**, not any one model, so `notify_on_cap` fires per window meter (5-hour / weekly / monthly), and the model block shows a `TOP 3 MODELS` split — each model's month AFP and its share of period AFP, then its tokens and their share of all tokens — instead of a per-model allowance ARK does not have; the table below carries no share of its own. The plan's own semantics are surfaced where they matter: no downgrade, the monthly quota is pro-rated on upgrade while the 5-hour and weekly windows reset to the new tier immediately, and plain API calls against the plan base URL are forbidden (ban risk) — the catalogue's `notes` carry these in `arkuse plans`. `arkuse plans` also lists the enterprise seat prices; their AFP is metered per seat and the personal usage API does not expose it, so only prices are shown.

Config lives at `~/.config/arkuse/config.json` with cmduse's keys (`interval_secs`, `bar_width`, `burst_enabled`, `burst_samples`, `notify_on_cap`, `statusline_template`, `statusline_colors`, `statusline_ascii`, `check_updates`, `dismissed_update`). The live frame refreshes every **5s** like the other two — each refresh is an `arkcli` control-plane round trip, so raise `interval_secs` (or pass `-i`) if that feels heavy on your machine. `arkuse daily|hourly|session|model --csv` use the repo's shared columns with `afp` in place of `cost_usd` (`afp` counts every token the coefficient prices, cache reads included).

## Notes

- Window bars: green &lt;70%, yellow 70–90%, red ≥90%, plus `LIMIT EXCEEDED` flag.
- Report tables: `daily` shows cache read and cache write as their own columns; `hourly` does not — it is `Hour / Reqs / In / Out / Cost`, and its CSV carries the same four plus `hour`. `daily` is bucketed in UTC unless `--tz`, and `--local` honors `--tz`; token totals in the model/session `Tokens` column include both cache columns. `ocuse`'s `--csv` columns are `day|hour|model|session,requests,tokens_in,tokens_out,cache_read,cost_usd` — its aggregates carry no cache-write, so that column is deliberately absent.
- Spend-burst sparkline appears in watch mode after 2 refreshes (bars = $ spent between refreshes, ~3 min of history at 5s interval, capped at 40 samples; tall = burst, flat = idle).
- `ocuse`'s watch frame uses the same three pieces: `redraw_frame` parks the cursor on the frame's last line (its status/countdown line), the sparkline tracks 5-hour spend deltas at 10s samples (capped at 60), and `Ink` carries `cmduse`'s palette as empty strings when colour is off.
- On Monthly caps: monthly pool is the plan total (e.g. $70 on GOAT). Docs describe per-model allowances, but the CLI and API meter one shared pool — verified empirically.

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/cmduse)
- [crates.io: cmd-usage](https://crates.io/crates/cmd-usage)
- [MIT license](LICENSE-MIT)
