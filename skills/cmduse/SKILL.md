---
name: cmduse
description: "Use when the user wants a Command Code, OpenCode Go/Zen, ARK Agent Plan or OpenDesign usage dashboard, daily or hourly reports, a statusline, a per-model or per-project report, or an MCP usage server, or says a plan window is near its cap."
---

# cmduse

The Rust CLI (`cmduse/`, crate `cmd-usage`) with four binaries: `cmduse` (Command Code), `ocuse` (OpenCode Go/Zen), `arkuse` (Volcengine ARK Agent Plan, in AFP), and `oduse` (OpenDesign, in credits). A live terminal dashboard, account-wide and local reports, a customisable statusline, and an MCP stdio server. All four share flags and output contracts; only source-forced flags differ.

## Install

```sh
brew install JeffreyJYZ/tap/cmduse   # macOS + Linux, prebuilt
cargo binstall cmd-usage             # any platform, prebuilt
cargo install cmd-usage              # build from source
```

Dev twins (`cmdusedev`, `ocusedev`, `arkusedev`, `odusedev`) avoid shadowing the installed binary; `cargo build --bin cmdusedev`. Consumers point at one with `CMDUSE_BIN` / `OCUSE_BIN` / `ARKUSE_BIN` / `ODUSE_BIN`.

## Commands

```sh
cmduse                       # live dashboard, redraws in place (default every 5s)
cmduse -1                    # one-shot fetch, print, exit
cmduse -p -1                 # plain output, no ANSI (scripts/pipes)
cmduse -i 30                 # refresh every 30s (s/m/h/d suffixes)
cmduse daily --days 14       # account usage by day (all harnesses)
cmduse daily --local         # local logs only (offline)
cmduse hourly --hours 6 --json
cmduse model [--days N | --since ISO] [id]   # local per-model usage
cmduse session --days 30     # local usage by project
cmduse models --gated        # live model list, current plan's allowed set
cmduse plans                 # plan comparison table
cmduse statusline            # compact one-liner for prompts/tmux
cmduse mcp                   # MCP stdio server
cmduse config set sl="{plan} {credits}/{cap} 5h:{5h_pct} wk:{wk_pct}"
```

`ocuse`, `arkuse` and `oduse` take the same shape: bare / `-1` / `daily` / `hourly` / `session` / `model` / `plans` / `statusline` / `mcp`. Source-forced differences: ocuse's `--plan go|go-plus|go-teams`, `--db`/`--no-api`/`--window`/`--period-start`/`--infer-anniversary`; arkuse's `--plan <tier>` and `--profile <arkcli>`; oduse's `--no-wallet`. One shared `--rows N` cap on every table (`0` = all); `--json`/`--csv` always carry every row, and a trimmed table ends `… N more`.

## MCP server and config

`cmduse mcp` (and each sibling) exposes seven tools: `usage`, `plans`, `models`, `daily`, `hourly`, `session`, `model`. Register each as a stdio server in your MCP host; the opencode plugin spawns the binary directly and does not need it.

Config: `~/.config/cmd-usage/config.json` (`interval_secs`, `bar_width`, `burst_enabled`, `burst_samples`, `notify_on_cap`, `statusline_template`, `statusline_colors`, `statusline_ascii`, `check_updates`, `dismissed_update`); set with `cmduse config set <key>=<value>`. Auth: `CMD_API_KEY`, else opencode's `commandcode` credential row, else `~/.commandcode/auth.json` (`cmd login`). Local logs: `PI_SESSIONS_DIR`, `DSH_SESSIONS_DIR`; update cache `~/.cache/cmd-usage/last-check`.

## Traps

- A `-1 --json` run exits 0 with defaults and an `error` string when the account API is unreachable — consumers must lift `error` and keep the last good snapshot, never paint a blank panel.
- `model --days N` is a **window**, not just a read cutoff; other commands treat `--days` as a read cutoff only.
- `daily`/`hourly` with `--local` still honour `--tz`; offsets are east-positive (`+05:30`).
- Colour is suppressed when stdout is not a terminal or `NO_COLOR` is set; `-p`/`--plain` works on every subcommand. Watch frames redraw in place — a shrinking frame clears with the documented byte sequence.
- The four binaries must stay at flag, MCP-tool, report-envelope and `statusline --json` key parity; `bun parity` checks flags and skips when binaries are absent.
- `ocuse` reads opencode's `opencode.db` (providers `opencode-go` + `opencode`) plus `pi`/`dsh` logs; which Go plan is active is not discoverable, so `--plan` is told (default `go`).
- `arkuse` meters in AFP including cache-read tokens; `reasoning` is already inside `output`, never add it again. Server windows cut at `reset − window`, never `now − window`.
- `oduse` reads a WAL store that is often locked — open read-only, never copy it. Its figures are estimates; the wallet line is a balance, not a meter.
- The plugin loads once per session attach, so module caches are shared across live sessions; keep the last-good snapshot keyed by model and session.

Full flag and behaviour spec: [cmduse README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/cmduse#readme) and `man cmduse` (installed by brew).
