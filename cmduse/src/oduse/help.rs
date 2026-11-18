// The `oduse` help text. It lives beside the binary it documents rather than in
// the shared parser, which already carries three of these — and its own block is
// long enough that folding it in would bury the flag parsing.
pub const ODUSE_HELP: &str = "oduse — OpenDesign usage (the desktop app's store + account / local wallet)

Usage: oduse [options]            Live plan dashboard (watch mode)
       oduse -1                   One-shot dashboard
       oduse daily [--days N] [--json]     Credits by day
       oduse hourly [--hours N] [--json]   Credits by hour
       oduse model [<id>] [--days N | --since ISO] [--json]  Local credits by model
       oduse session [--json]              Local credits by session
       oduse models               Model multipliers and rates
       oduse plans                The plan catalogue: caps, credits, rates
       oduse statusline           Compact one-liner for prompts/tmux
       oduse mcp                  MCP stdio server (usage/plans/models/daily/hourly/session/model tools)
       oduse config set interval=<s> width=<n> burst_on=true burst=40

Options:
  -1, --once            Fetch once, print, exit (no watch)
  -W, --watch           Force watch mode (default; conflicts with -1)
  -p, --plain           No colors / no live redraw (for scripts, pipes)
  -i, --interval <dur>  Refresh interval (default: config or 5s). Accepts a
                        unit suffix: 30s, 5m, 1h (bare number = seconds)
  -w, --bar-width <n>   Progress bar width in chars (default: config or 20)
  -b, --bursts <n>      Spend-burst sparkline samples (default: 40; hide when
                        idle via config burst_on=false)
      --json            Machine-readable JSON output where supported
      --csv             CSV output for daily/hourly/model/session
      --dismiss-update  Ack the current update notice (hides it until a newer
                        version; same as config set dismissed_update=<ver>)
      --tz <±HH:MM>     daily/hourly: bucket by this UTC offset instead of UTC
      -l, --days <n>    daily: days back (same as --last; default 120 because the
                        store is local, max 365)
      --hours <n>       hourly: number of hours back (default 24, max 168)
      --since <ISO>     model/session: count from this instant instead of --days
      --db <path>       the app's store (default $OD_DB or
                        ~/Library/Application Support/Open Design/namespaces/
                        release-stable/data/app.sqlite)
      --plan <id>       plan to measure against: go (default), plus, pro, max
      --no-wallet       skip both wallet routes (account API and local daemon)
      --session-cookie <path>  file holding the console session cookie (0600);
                        or set $OD_SESSION / $OD_SESSION_COOKIE. Never scraped
                        from a browser; the app's local daemon is the fallback
      --window <w>      report window: month (default), all, or <n>d
      --period-start <date>  pin the period start (YYYY-MM-DD, UTC)
      --infer-anniversary   infer the period start from the first turn
      --rows <n>        table rows to print (0 = all)
  -V, --version         Print version
  -h, --help            This help
  Respects NO_COLOR; colors auto-off when stdout is not a terminal.

Config: ~/.config/oduse/config.json
  { \"interval_secs\": 5, \"bar_width\": 20, \"burst_enabled\": true,
    \"burst_samples\": 40, \"notify_on_cap\": true, \"statusline_template\": \"…\",
    \"statusline_colors\": true, \"statusline_ascii\": false,
    \"check_updates\": true, \"dismissed_update\": null }

Reads the Open Design desktop app's own store. The wallet balance comes from
GET $OD_API_URL/api/v1/wallet/balance with a user-supplied console session cookie
($OD_SESSION / $OD_SESSION_COOKIE / --session-cookie <0600 file>), or, when no
credential is set, the app's local daemon (127.0.0.1:7456, $OD_PORT/$OD_DAEMON_URL).
--json names the route in walletSource (api | daemon | null). A cookie expires:
refresh it from the console when the frame says HTTP 401. The plan's windows are
computed here — no per-window usage API exists — so the figures are estimates:
usage events carry no cache tokens.";
