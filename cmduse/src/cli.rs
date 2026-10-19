use lexopt::prelude::*;

/// Which binary is running. The two share one parser/config/notify front-end;
/// only a handful of flags are binary-gated (see [`Args`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Binary {
    #[default]
    Cmduse,
    Ocuse,
    Arkuse,
}

impl Binary {
    /// The name used in `-V/--version` and the usage header.
    pub fn name(self) -> &'static str {
        match self {
            Binary::Cmduse => "cmduse",
            Binary::Ocuse => "ocuse",
            Binary::Arkuse => "arkuse",
        }
    }
}

#[derive(Debug, Default)]
pub struct Args {
    /// The binary this argv was parsed for (gates `--local`/`--gated` vs the
    /// ocuse-only flags).
    pub binary: Binary,
    pub interval: Option<u64>,
    pub once: bool,
    /// Explicit `-W`/`watch` seen (as opposed to the implicit default mode).
    pub watch: bool,
    pub plain: bool,
    pub bar_width: Option<usize>,
    pub bursts: Option<usize>,
    pub help: bool,
    pub config_set: Option<ConfigSet>,
    pub subcmd: Option<SubCmd>,
    pub last: Option<usize>,
    pub hours: Option<usize>,
    pub json: bool,
    pub csv: bool,
    pub local: bool,
    pub gated: bool,
    pub tz: Option<i64>,
    pub dismiss_update: bool,
    /// ISO-8601 start of the window, for `model`/`session`.
    pub since: Option<String>,
    // --- ocuse-only (the cmduse binary rejects these) ---
    /// opencode store path (`--db`).
    pub db: Option<String>,
    /// Go plan / ARK tier to measure against (`--plan`).
    pub plan: Option<String>,
    /// ARK control-plane profile (`--profile`), resolved from arkcli otherwise.
    pub profile: Option<String>,
    /// Report window (`--window`): month, all, or `<n>d`.
    pub window: Option<String>,
    /// Pinned period start (`--period-start`), `YYYY-MM-DD`.
    pub period_start: Option<String>,
    /// Infer the period start from the first Go request (`--infer-anniversary`).
    pub infer_anniversary: bool,
    /// Table rows to print (`--rows`).
    pub rows: Option<usize>,
    /// Skip OpenCode Go's usage endpoint (`--no-api`): stay local-only.
    pub no_api: bool,
}

#[derive(Debug, Default)]
pub struct ConfigSet {
    pub interval: Option<u64>,
    pub width: Option<usize>,
    pub sl_template: Option<String>,
    pub sl_colors: Option<bool>,
    pub sl_ascii: Option<bool>,
    pub bursts: Option<usize>,
    pub burst_on: Option<bool>,
    pub notify: Option<bool>,
    pub update_check: Option<bool>,
    pub dismissed_update: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum SubCmd {
    Daily,
    Hours,
    Model,
    Session,
    Statusline,
    Models,
    Plans,
    Mcp,
}

pub fn parse_args(binary: Binary) -> Args {
    match parse_args_from(std::env::args_os(), binary) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    }
}

/// Parse a full argv (binary name first, as `std::env::args_os` yields) for the
/// named binary. Split out so tests can drive it without touching the real
/// process args.
pub(crate) fn parse_args_from(
    args: impl IntoIterator<Item = std::ffi::OsString>,
    binary: Binary,
) -> Result<Args, String> {
    let mut a = Args {
        binary,
        ..Args::default()
    };
    let mut parser = lexopt::Parser::from_iter(args);
    let (mut saw_once, mut saw_watch) = (false, false);
    while let Some(arg) = parser.next().map_err(|e| e.to_string())? {
        match arg {
            Short('1') | Long("once") => {
                a.once = true;
                saw_once = true;
            }
            Short('p') | Long("plain") => a.plain = true,
            Short('W') | Long("watch") => {
                a.once = false; // explicit default mode
                a.watch = true;
                saw_watch = true;
            }
            Short('h') | Long("help") => a.help = true,
            Short('V') | Long("version") => {
                println!("{} {}", binary.name(), env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            Long("json") => a.json = true,
            Long("csv") => a.csv = true,
            // Shared: `--gated` filters `models`, and both binaries have a model
            // catalogue (cmduse's live API list, ocuse's Go/plan allowance table).
            Long("gated") => a.gated = true,
            Long("dismiss-update") => a.dismiss_update = true,
            Long("tz") => {
                let v = need_value(&mut parser, "--tz needs an offset like +05:30 or -08:00")?;
                match parse_tz(&v) {
                    Some(secs) => a.tz = Some(secs),
                    None => {
                        return Err(format!(
                            "--tz needs an offset like +05:30 or -08:00 (got '{v}')"
                        ))
                    }
                }
            }
            Short('i') | Long("interval") => {
                let v = need_value(
                    &mut parser,
                    "-i needs a duration 1s–24h (e.g. 30, 30s, 5m, 1h)",
                )?;
                match parse_duration(&v) {
                    Some(n) if (1..=86_400).contains(&n) => a.interval = Some(n),
                    _ => {
                        return Err(format!(
                            "-i needs a duration 1s–24h (e.g. 30, 30s, 5m, 1h) (got '{v}')"
                        ))
                    }
                }
            }
            Short('w') | Long("bar-width") => {
                let v = need_value(&mut parser, "-w needs a number 5–200")?;
                match v.parse::<usize>() {
                    Ok(n) if (5..=200).contains(&n) => a.bar_width = Some(n),
                    _ => return Err(format!("-w needs a number 5–200 (got '{v}')")),
                }
            }
            Short('b') | Long("bursts") => {
                let v = need_value(&mut parser, "-b needs a number 5–240")?;
                match v.parse::<usize>() {
                    Ok(n) if (5..=240).contains(&n) => a.bursts = Some(n),
                    _ => return Err(format!("-b needs a number 5–240 (got '{v}')")),
                }
            }
            Long("days") | Long("last") | Short('l') => {
                let v = need_value(&mut parser, "--days needs a number (e.g. --days 7)")?;
                match v.parse::<usize>() {
                    Ok(n) => a.last = Some(n.clamp(1, 365)),
                    Err(_) => return Err("--days needs a number (e.g. --days 7)".into()),
                }
            }
            Long("since") => {
                let v = need_value(&mut parser, "--since needs an ISO-8601 time")?;
                if cmduse_core::dates::parse_iso_utc(&v).is_none() {
                    return Err(format!("--since: not an ISO-8601 datetime: '{v}'"));
                }
                a.since = Some(v);
            }
            Long("hours") => {
                let v = need_value(
                    &mut parser,
                    "--hours needs a number (e.g. --hours 6, max 168)",
                )?;
                match v.parse::<usize>() {
                    Ok(n) => a.hours = Some(n.clamp(1, 168)),
                    Err(_) => return Err("--hours needs a number (e.g. --hours 6, max 168)".into()),
                }
            }
            // --- cmduse-only flags ---
            Long("local") => {
                if binary != Binary::Cmduse {
                    return Err(unknown_long("local"));
                }
                a.local = true;
            }
            // --- ocuse/arkuse-only flags ---
            Long("db") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("db"));
                }
                a.db = Some(need_value(&mut parser, "--db needs a path")?);
            }
            Long("plan") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("plan"));
                }
                a.plan = Some(need_value(&mut parser, "--plan needs an id")?);
            }
            Long("profile") => {
                if binary != Binary::Arkuse {
                    return Err(unknown_long("profile"));
                }
                a.profile = Some(need_value(&mut parser, "--profile needs a name")?);
            }
            Long("no-api") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("no-api"));
                }
                a.no_api = true;
            }
            Long("window") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("window"));
                }
                a.window = Some(need_value(
                    &mut parser,
                    "--window needs month, all, or <n>d",
                )?);
            }
            Long("period-start") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("period-start"));
                }
                a.period_start = Some(need_value(&mut parser, "--period-start needs YYYY-MM-DD")?);
            }
            Long("infer-anniversary") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("infer-anniversary"));
                }
                a.infer_anniversary = true;
            }
            Long("rows") => {
                if !matches!(binary, Binary::Ocuse | Binary::Arkuse) {
                    return Err(unknown_long("rows"));
                }
                let v = need_value(&mut parser, "--rows needs a number")?;
                match v.parse::<usize>() {
                    Ok(n) => a.rows = Some(n),
                    Err(_) => return Err(format!("--rows needs a number (got '{v}')")),
                }
            }
            Value(v) => match v.to_string_lossy().as_ref() {
                "watch" => {
                    a.once = false;
                    a.watch = true;
                    saw_watch = true;
                }
                "help" => a.help = true,
                "version" => {
                    println!("{} {}", binary.name(), env!("CARGO_PKG_VERSION"));
                    std::process::exit(0);
                }
                "daily" | "days" => a.subcmd = Some(SubCmd::Daily),
                "hourly" | "hours" => a.subcmd = Some(SubCmd::Hours),
                "model" => a.subcmd = Some(SubCmd::Model),
                "session" | "sessions" | "project" => a.subcmd = Some(SubCmd::Session),
                "models" => a.subcmd = Some(SubCmd::Models),
                "plans" => a.subcmd = Some(SubCmd::Plans),
                "mcp" => a.subcmd = Some(SubCmd::Mcp),
                "statusline" => a.subcmd = Some(SubCmd::Statusline),
                "config" => a.config_set = Some(parse_config_set(&mut parser)?),
                other => return Err(format!("unknown arg: {other} (try --help)")),
            },
            Short(c) => return Err(format!("unknown arg: -{c} (try --help)")),
            Long(l) => return Err(unknown_long(l)),
        }
    }
    if saw_once && saw_watch {
        return Err("cannot combine -1/--once with -W/--watch".into());
    }
    if a.json && a.csv {
        return Err("cannot combine --json with --csv".into());
    }
    Ok(a)
}

fn unknown_long(flag: &str) -> String {
    format!("unknown arg: --{flag} (try --help)")
}

fn need_value(parser: &mut lexopt::Parser, msg: &str) -> Result<String, String> {
    parser
        .value()
        .map(|v| v.to_string_lossy().into_owned())
        .map_err(|_| msg.to_string())
}

/// `config set [key=value …]` — the rest of argv after the `config` positional.
fn parse_config_set(parser: &mut lexopt::Parser) -> Result<ConfigSet, String> {
    match parser.next().map_err(|e| e.to_string())? {
        Some(Value(v)) if v.to_string_lossy() == "set" => {}
        Some(Value(v)) => {
            return Err(format!(
                "config: unknown subcommand '{}' (try: config set interval=10)",
                v.to_string_lossy()
            ))
        }
        _ => return Err("config: missing subcommand (try: config set interval=10)".into()),
    }
    let mut cs = ConfigSet::default();
    while let Some(arg) = parser.next().map_err(|e| e.to_string())? {
        let Value(kv) = arg else {
            return Err("config: expected key=value".into());
        };
        let kv = kv.to_string_lossy();
        let Some((k, v)) = kv.split_once('=') else {
            return Err(format!(
                "config: expected key=value, got '{kv}' (keys: interval, width)"
            ));
        };
        match k {
            "interval" => {
                cs.interval = Some(
                    v.parse()
                        .map_err(|_| format!("config: interval must be a number, got '{v}'"))?,
                )
            }
            "width" => {
                cs.width = Some(
                    v.parse()
                        .map_err(|_| format!("config: width must be a number, got '{v}'"))?,
                )
            }
            "sl" | "statusline" => cs.sl_template = Some(v.to_string()),
            "sl_colors" => cs.sl_colors = Some(parse_bool(v, "sl_colors")?),
            "sl_ascii" => cs.sl_ascii = Some(parse_bool(v, "sl_ascii")?),
            "burst" | "bursts" => {
                cs.bursts = Some(
                    v.parse()
                        .map_err(|_| format!("config: bursts must be a number, got '{v}'"))?,
                )
            }
            "burst_on" | "burst-on" => cs.burst_on = Some(parse_bool(v, "burst_on")?),
            "notify" | "notify_on_cap" => cs.notify = Some(parse_bool(v, "notify")?),
            "update" | "update_check" | "check_updates" => {
                cs.update_check = Some(parse_bool(v, "update_check")?)
            }
            "dismiss" | "dismissed_update" => {
                if v.is_empty() || v.contains(char::is_whitespace) {
                    return Err("dismissed_update must be a version like 0.6.8".into());
                }
                cs.dismissed_update = Some(v.to_string())
            }
            other => {
                return Err(format!(
                    "config: unknown key '{other}' (keys: interval, width, sl, sl_colors, sl_ascii, burst, burst_on, notify, update_check, dismissed_update)"
                ))
            }
        }
    }
    Ok(cs)
}

fn parse_bool(v: &str, key: &str) -> Result<bool, String> {
    v.parse()
        .map_err(|_| format!("config: {key} must be true/false, got '{v}'"))
}

/// Parse a refresh duration: bare seconds ("30"), or with a unit suffix
/// ("30s", "5m", "1h", "2d"). Returns whole seconds.
pub fn parse_duration(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (num, mult) = match s.chars().last()? {
        's' | 'S' => (&s[..s.len() - 1], 1u64),
        'm' | 'M' => (&s[..s.len() - 1], 60),
        'h' | 'H' => (&s[..s.len() - 1], 3600),
        'd' | 'D' => (&s[..s.len() - 1], 86400),
        _ => (s, 1),
    };
    num.parse::<u64>().ok().and_then(|n| n.checked_mul(mult))
}

/// Parse a UTC offset "+05:30" / "-08:00" / "+0530" / "-8" → seconds east.
/// Splitting lives in `cmduse_core::dates`; this adds the CLI's range check.
pub fn parse_tz(s: &str) -> Option<i64> {
    let (sign, h, m) = cmduse_core::dates::parse_tz_parts(s)?;
    if h > 14 || m > 59 {
        return None;
    }
    Some(sign * (h * 3600 + m * 60))
}

pub fn usage(binary: Binary) {
    println!("{}", usage_text(binary));
}

/// The `cmduse` help text — byte-identical to what it has always printed.
const CMDUSE_HELP: &str = "cmduse — Command Code usage dashboard

Usage: cmduse [options]           Live plan dashboard (watch mode)
       cmduse -1                  One-shot dashboard
       cmduse daily [--days N] [--json]    Account usage by day (all harnesses)
       cmduse hourly [--hours N] [--json]  Account usage by hour (all harnesses)
       cmduse model [--days N | --since ISO] [--json]   Local usage by model
       cmduse session [--days N | --since ISO] [--json] Local usage by project/session
       cmduse models              Live model list from the Command Code API
       cmduse plans               Plan comparison table
       cmduse statusline          Compact one-liner for prompts/tmux
       cmduse mcp                 MCP stdio server (usage/plans/models/daily/hourly/session/model tools)
       cmduse config set interval=<s> width=<n> burst_on=true burst=40

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
      --gated           models: filter to what the current plan allows
      --dismiss-update  Ack the current update notice (hides it until a newer
                        version; same as config set dismissed_update=<ver>)
      --tz <±HH:MM>     daily/hourly: bucket by this UTC offset instead of UTC
                        (applies to local logs too)
      --days <n>        daily: number of days back (default 7, max 365)
      --hours <n>       hourly: number of hours back (default 24, max 168)
      --since <ISO>     model/session: count from this instant instead of --days
      --local           daily: use local CLI logs only (skip account API)
  -V, --version         Print version
  -h, --help            This help
  Respects NO_COLOR; colors auto-off when stdout is not a terminal.

Config: ~/.config/cmd-usage/config.json
  { \"interval_secs\": 5, \"bar_width\": 20, \"burst_enabled\": true,
    \"burst_samples\": 40, \"notify_on_cap\": true, \"statusline_template\": \"…\",
    \"statusline_colors\": true, \"statusline_ascii\": false,
    \"check_updates\": true, \"dismissed_update\": null }

daily/model/session read ~/.commandcode/projects offline (no API calls).
Dashboard needs: logged-in Command Code CLI (~/.commandcode/auth.json)";

/// The `ocuse` help text: the shared block plus its own extras and the
/// ocuse-only flags. Kept in sync with `CMDUSE_HELP` by the parity test in
/// `cli_tests` (every shared token cmduse prints must print here too).
const OCUSE_HELP: &str = "ocuse — OpenCode Go/Zen usage (opencode.db + Go's usage endpoint)

Usage: ocuse [options]            Live plan dashboard (watch mode)
       ocuse -1                   One-shot dashboard
       ocuse daily [--days N] [--json]     Spend by day
       ocuse hourly [--hours N] [--json]   Spend by hour
       ocuse model [--since ISO] [--json]  Local usage by model
       ocuse session [--json]              Local usage by session
       ocuse models               Model list
       ocuse plans                The Go/Zen catalogue: both plans' limits and rates
       ocuse statusline           Compact one-liner for prompts/tmux
       ocuse mcp                  MCP stdio server (usage/plans/models/daily/hourly/session/model tools)
       ocuse config set interval=<s> width=<n> burst_on=true burst=40

Options:
  -1, --once            Fetch once, print, exit (no watch)
  -W, --watch           Force watch mode (default; conflicts with -1)
  -p, --plain           No colors / no live redraw (for scripts, pipes)
  -i, --interval <dur>  Refresh interval (default: config or 10s). Accepts a
                        unit suffix: 30s, 5m, 1h (bare number = seconds)
  -w, --bar-width <n>   Progress bar width in chars (default: config or 20)
  -b, --bursts <n>      Spend-burst sparkline samples (default: 40; hide when
                        idle via config burst_on=false)
      --json            Machine-readable JSON output where supported
      --csv             CSV output for daily/hourly/model/session
      --dismiss-update  Ack the current update notice (hides it until a newer
                        version; same as config set dismissed_update=<ver>)
      --tz <±HH:MM>     daily/hourly: bucket by this UTC offset instead of UTC
                        (applies to local logs too)
      --days <n>        daily: number of days back (default 120, max 365)
      --hours <n>       hourly: number of hours back (default 24, max 168)
      --since <ISO>     model/session: count from this instant instead of --days
      --gated           models: filter to what the selected plan grants
      --db <path>       opencode store (default $OPENCODE_DB or
                        ~/.local/share/opencode/opencode.db)
      --plan <id>       Go plan to measure against: go (default) or go-plus
      --no-api          Skip OpenCode Go's usage endpoint and stay local-only
      --window <w>      report window: month (default), all, or <n>d
      --period-start <date>  pin the period start (YYYY-MM-DD, UTC)
      --infer-anniversary   infer the period start from the first Go request
      --rows <n>        table rows to print (default 15)
  -V, --version         Print version
  -h, --help            This help
  Respects NO_COLOR; colors auto-off when stdout is not a terminal.

Config: ~/.config/ocuse/config.json
  { \"interval_secs\": 10, \"bar_width\": 20, \"burst_enabled\": true,
    \"burst_samples\": 40, \"notify_on_cap\": true, \"statusline_template\": \"…\",
    \"statusline_colors\": true, \"statusline_ascii\": false,
    \"check_updates\": true, \"dismissed_update\": null }

Reads opencode's own store, and OpenCode Go's usage endpoint when a Go key is
present (the account's own meters — what opencode.ai/console shows). Without a
key, no network, or with --no-api, the windows fall back to a local estimate.";

/// The `arkuse` help text: the shared block plus ARK's own flags. Same parity
/// rule as ocuse's (the shared tokens are asserted by `cli_tests`).
const ARKUSE_HELP: &str = "arkuse — Volcengine ARK Agent Plan usage (opencode.db + arkcli control plane)

Usage: arkuse [options]           Live plan dashboard (watch mode)
       arkuse -1                  One-shot dashboard
       arkuse daily [--days N] [--json]     AFP by day
       arkuse hourly [--hours N] [--json]   AFP by hour
       arkuse model [--since ISO] [--json]  Local AFP by model
       arkuse session [--json]              Local AFP by session
       arkuse models              Model coefficients and tier gates
       arkuse plans               The Agent Plan catalogue: tiers, AFP, prices
       arkuse statusline          Compact one-liner for prompts/tmux
       arkuse mcp                 MCP stdio server (usage/plans/models/daily/hourly/session/model tools)
       arkuse config set interval=<s> width=<n> burst_on=true burst=40

Options:
  -1, --once            Fetch once, print, exit (no watch)
  -W, --watch           Force watch mode (default; conflicts with -1)
  -p, --plain           No colors / no live redraw (for scripts, pipes)
  -i, --interval <dur>  Refresh interval (default: config or 15s). Accepts a
                        unit suffix: 30s, 5m, 1h (bare number = seconds)
  -w, --bar-width <n>   Progress bar width in chars (default: config or 20)
  -b, --bursts <n>      AFP-burst sparkline samples (default: 40; hide when
                        idle via config burst_on=false)
      --json            Machine-readable JSON output where supported
      --csv             CSV output for daily/hourly/model/session
      --dismiss-update  Ack the current update notice (hides it until a newer
                        version; same as config set dismissed_update=<ver>)
      --tz <±HH:MM>     daily/hourly: bucket by this UTC offset instead of UTC
                        (applies to local logs too)
      --days <n>        daily: number of days back (default 120, max 365)
      --hours <n>       hourly: number of hours back (default 24, max 168)
      --since <ISO>     model/session: count from this instant instead of --days
      --gated           models: filter to what the selected tier grants
      --db <path>       opencode store (default $OPENCODE_DB or
                        ~/.local/share/opencode/opencode.db)
      --plan <id>       ARK tier: small, medium (default), large, max
      --profile <name>  arkcli control-plane profile (default: the first
                        agent-plan profile, or $ARKUSE_PROFILE)
      --no-api          Skip arkcli and stay on the local AFP estimate
      --window <w>      report window: month (default), all, or <n>d
      --period-start <date>  pin the period start (YYYY-MM-DD)
      --infer-anniversary   infer the period start from the first plan request
      --rows <n>        table rows to print (default 15)
  -V, --version         Print version
  -h, --help            This help
  Respects NO_COLOR; colors auto-off when stdout is not a terminal.

Config: ~/.config/arkuse/config.json
  { \"interval_secs\": 15, \"bar_width\": 20, \"burst_enabled\": true,
    \"burst_samples\": 40, \"notify_on_cap\": true, \"statusline_template\": \"…\",
    \"statusline_colors\": true, \"statusline_ascii\": false,
    \"check_updates\": true, \"dismissed_update\": null }

AFP is the plan's own currency (1 AFP = ¥0.002). Window rows prefer the control
plane's meters (`arkcli usage plan`); the local figure is computed from the
documented coefficients and reconciled against the meter every poll.";

pub fn usage_text(binary: Binary) -> &'static str {
    match binary {
        Binary::Cmduse => CMDUSE_HELP,
        Binary::Ocuse => OCUSE_HELP,
        Binary::Arkuse => ARKUSE_HELP,
    }
}
