// ocuse — OpenCode Go/Zen usage, same CLI shape as cmduse.
//
// Data: opencode's own store (read-only) plus the generated docs catalogue.
// There is no OpenCode usage API to ask (see core/zen.json's header and the
// README), so this reports what actually ran on this machine, priced by
// opencode itself, against the limits the docs publish.
//
// The front-end is the shared one: `cmduse/src/cli.rs` parses argv for both
// binaries, `config.rs` owns both config files, `notify.rs` the desktop
// notification, `update_check.rs` the crates.io notice. ocuse only supplies its
// own source (the store) and its own renderers.
//
// Lives in the library (not the bin) so `ocuse` and its `ocusedev` twin share
// one entry point: both bins are `fn main() { cmd_usage::ocuse::run(); }`.
use crate::cli::{self, Binary, SubCmd};
use crate::ocuse::window;
use crate::ocuse::{build, db, mcp, render, zen};
use crate::report_render::Fmt;
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::Write;

/// `YYYY-MM-DD` -> epoch ms at 00:00 UTC, via the same civil helpers the window
/// module uses (no date dependency).
fn parse_day(value: &str) -> Option<i64> {
    let mut parts = value.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let d: i64 = parts.next()?.parse().ok()?;
    (1..=12).contains(&m).then_some(())?;
    (1..=31).contains(&d).then_some(())?;
    Some(window::days_from_civil(y, m, d) * 86_400_000)
}

/// Flags whose value is the next argv token (mirrors the shared parser). Used
/// only to locate ocuse's `model <id>` positional before it parses.
const VALUE_FLAGS: &[&str] = &[
    "-i",
    "--interval",
    "-w",
    "--bar-width",
    "-b",
    "--bursts",
    "--days",
    "--last",
    "-l",
    "--since",
    "--hours",
    "--tz",
    "--db",
    "--plan",
    "--window",
    "--period-start",
    "--rows",
];

/// ocuse's `model` command takes an optional model id, which is a plain
/// positional; the shared parser (written for cmduse, whose `model` takes none)
/// rejects a stray positional. Pull the id out first so `ocuse model <id>`
/// keeps working — the rest of argv parses exactly as the shared parser does.
fn split_model_id(argv: Vec<OsString>) -> (Vec<OsString>, Option<String>) {
    let strs: Vec<String> = argv
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let mut drop_at = None;
    let mut skip_value = false;
    let mut after_model = false;
    for (i, tok) in strs.iter().enumerate() {
        if skip_value {
            skip_value = false;
            continue;
        }
        if tok.starts_with('-') {
            // `--flag=value` carries its own value; `-w40` is attached, not a
            // separate token. Only the bare value flags consume the next token.
            if VALUE_FLAGS.contains(&tok.as_str()) {
                skip_value = true;
            }
            continue;
        }
        if after_model {
            drop_at = Some(i);
            break;
        }
        after_model = tok == "model";
    }
    let id = drop_at.map(|i| strs[i].clone());
    let argv = argv
        .into_iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != drop_at)
        .map(|(_, a)| a)
        .collect();
    (argv, id)
}

/// The live watch loop is the default command, but `-1`/`--once` and `--json`
/// both want a single frame printed and an exit. A bare `--json` used to fall
/// into the loop and print no JSON at all, so it is one-shot too.
fn wants_watch(args: &cli::Args) -> bool {
    !args.once && !args.json
}

/// cmduse's small-terminal rule: one clipped line instead of the full frame.
fn compact_frame(rows: usize, cols: usize) -> bool {
    cols > 0 && (rows < 16 || cols < 40)
}

/// Spend-burst sparkline derivation, identical to cmduse's `lib.rs`: a CLI
/// `-b/--bursts` turns it on for the run; otherwise it follows the config flag.
/// The cap is the CLI value, else the config sample count, clamped 5–240.
fn burst_config(bursts: Option<usize>, enabled: bool, samples: usize) -> (bool, usize) {
    let on = bursts.is_some() || enabled;
    let cap = if on {
        bursts.or(Some(samples)).unwrap_or(40).clamp(5, 240)
    } else {
        0
    };
    (on, cap)
}

/// Report output format, mirroring cmduse's (`--json` / `--csv` / table).
fn output_fmt(args: &cli::Args) -> Fmt {
    if args.json {
        Fmt::Json
    } else if args.csv {
        Fmt::Csv
    } else {
        Fmt::Table
    }
}

pub fn run() {
    let (argv, model_id) = split_model_id(std::env::args_os().collect());
    let args = match cli::parse_args_from(argv, Binary::Ocuse) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if args.help {
        cli::usage(Binary::Ocuse);
        return;
    }
    if let Some(cs) = args.config_set {
        if let Err(e) = crate::config::set(Binary::Ocuse, &cs) {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
        return;
    }
    if args.dismiss_update {
        match crate::update_check::latest_newer() {
            Ok(Some(v)) => match crate::config::set_dismissed(Binary::Ocuse, &v) {
                Ok(()) => println!("dismissed update notice for {v}"),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            },
            Ok(None) => println!("ocuse is up to date ({})", env!("CARGO_PKG_VERSION")),
            Err(e) => {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let cfg = crate::config::load(Binary::Ocuse);
    let colours = !args.plain && crate::render::color_enabled();
    let fmt = output_fmt(&args);
    let db_path = args.db.clone().unwrap_or_else(db::default_path);
    let days: i64 = args.last.unwrap_or(120) as i64;
    let hours: i64 = args.hours.unwrap_or(24) as i64;
    let rows: usize = args.rows.unwrap_or(15);
    let now = window::now_ms();
    let tz_secs = args.tz.unwrap_or(0);

    // `plans` needs neither the store nor a plan id: the catalogue is static.
    if let Some(SubCmd::Plans) = args.subcmd {
        if args.json {
            print!("{}", render::plans_json());
        } else {
            print!("{}", render::plans_text(colours));
        }
        return;
    }

    // Which Go plan the allowances are measured against: explicit, because the
    // store records no subscription and there is no usage API to ask.
    let catalog = zen::catalog();
    let plan_id = args
        .plan
        .clone()
        .unwrap_or_else(|| zen::DEFAULT_PLAN.to_string());
    if catalog.plan(&plan_id).is_none() {
        eprintln!(
            "ocuse: --plan expects one of {} (got {plan_id})",
            catalog.plan_ids().join(", ")
        );
        std::process::exit(2);
    }

    // `models` is the catalogue joined with one plan's allowances: no store read.
    if let Some(SubCmd::Models) = args.subcmd {
        if args.json {
            print!("{}", render::models_json(&plan_id, args.gated));
        } else {
            print!("{}", render::models_text(&plan_id, args.gated, colours));
        }
        return;
    }

    // `--since` (an ISO-8601 instant) pins the report window for model/session,
    // as in cmduse; it outranks --period-start and --window. `parse_iso_utc`
    // yields epoch milliseconds (the same units as the store's timestamps).
    let since_override = args
        .since
        .as_deref()
        .and_then(cmduse_core::dates::parse_iso_utc)
        .map(|ms| ms as i64);

    // The period: explicit start > window mode > calendar month. Inference from
    // the first Go request is opt-in because it guesses badly on sparse history
    // (an account whose usage starts mid-cycle infers the wrong anniversary).
    let window_mode = args.window.clone().unwrap_or_else(|| "month".into());
    let period_start = if let Some(ms) = since_override {
        Some(ms)
    } else if let Some(day) = args.period_start.as_deref().and_then(parse_day) {
        Some(day)
    } else if window_mode == "all" {
        Some(0)
    } else if window_mode == "month" {
        Some(window::calendar_month_start(now))
    } else if let Some(d) = window_mode
        .strip_suffix('d')
        .and_then(|v| v.parse::<i64>().ok())
    {
        Some(now - d * 86_400_000)
    } else {
        eprintln!("ocuse: --window expects month, all, or <n>d (got {window_mode})");
        std::process::exit(2);
    };
    let period_label = if let Some(iso) = &args.since {
        format!("since {iso}")
    } else if args.period_start.is_some() {
        "period start (pinned)".to_string()
    } else {
        match window_mode.as_str() {
            "all" => "all time".to_string(),
            "month" => "calendar month".to_string(),
            other => other.to_string(),
        }
    };
    let period_start =
        if args.infer_anniversary && args.period_start.is_none() && args.since.is_none() {
            None
        } else {
            period_start
        };

    let read_since = |since_ms: i64| match db::read_rows(&db_path, since_ms) {
        Ok(rows) => rows,
        Err(error) => {
            eprintln!("ocuse: {error}");
            eprintln!("hint: --db <path>, or OPENCODE_DB; the store is created by opencode itself");
            std::process::exit(1);
        }
    };
    // The report's own read window: an explicit --since pins it, else --days.
    let report_window = since_override.unwrap_or(now - days * 86_400_000);
    let build_at = |t: i64| {
        let mut report = build(
            &read_since(report_window),
            &catalog,
            &plan_id,
            t,
            period_start,
        );
        report.period_label = period_label.clone();
        report
    };

    match args.subcmd {
        Some(SubCmd::Statusline) => {
            let report = build_at(now);
            if args.json {
                println!("{}", render::statusline_json(&report, &plan_id));
            } else {
                print!(
                    "{}",
                    render::statusline_template(
                        &report,
                        &plan_id,
                        &cfg.statusline_template,
                        cfg.statusline_colors,
                        cfg.statusline_ascii,
                        cfg.bar_width.min(30),
                    )
                );
            }
            return;
        }
        Some(SubCmd::Daily) => {
            print!(
                "{}",
                render::bucket_text(
                    &read_since(now - days * 86_400_000),
                    now,
                    days * 86_400_000,
                    86_400_000,
                    tz_secs,
                    colours,
                    fmt,
                )
            );
            return;
        }
        Some(SubCmd::Hours) => {
            print!(
                "{}",
                render::bucket_text(
                    &read_since(now - hours * 3_600_000),
                    now,
                    hours * 3_600_000,
                    3_600_000,
                    tz_secs,
                    colours,
                    fmt,
                )
            );
            return;
        }
        Some(SubCmd::Session) => {
            print!(
                "{}",
                render::session_text(&read_since(report_window), 20, colours, fmt)
            );
            return;
        }
        Some(SubCmd::Mcp) => {
            // stdio JSON-RPC; stdout carries protocol only, so nothing else may print.
            mcp::run(&db_path, days, tz_secs, false, &plan_id, period_start);
            return;
        }
        Some(SubCmd::Model) => {
            let report = build_at(now);
            if fmt == Fmt::Table {
                match &model_id {
                    Some(id) => print!("{}", render::model_text(&report, id, colours)),
                    None => print!(
                        "{}",
                        render::render_text(
                            &report,
                            &db_path,
                            usize::MAX,
                            colours,
                            args.bar_width.unwrap_or(cfg.bar_width).clamp(5, 200),
                        )
                    ),
                }
            } else {
                print!(
                    "{}",
                    render::model_report(&report, model_id.as_deref(), fmt)
                );
            }
            return;
        }
        // served above: plans and models need no store read
        Some(SubCmd::Plans) | Some(SubCmd::Models) => return,
        None => {}
    }

    // Dashboard (the default command): one-shot or live watch.
    let interval = args.interval.unwrap_or(cfg.interval_secs).clamp(1, 86_400);
    let bar_width = args.bar_width.unwrap_or(cfg.bar_width).clamp(5, 200);
    let (burst_on, burst_cap) = burst_config(args.bursts, cfg.burst_enabled, cfg.burst_samples);
    let notify_on_cap = cfg.notify_on_cap;

    // Update check before any output. Watch mode draws the notice inside the
    // redrawn frame (an eprintln sits outside the in-place UI and scrolls away);
    // one-shot has no frame, so it goes to stderr.
    let update =
        crate::update_check::check_sync(cfg.check_updates, cfg.dismissed_update.as_deref());

    if !wants_watch(&args) {
        if let Some(msg) = &update {
            eprintln!("{msg}");
        }
        let report = build_at(now);
        if args.json {
            println!("{}", render::render_json(&report));
        } else {
            print!(
                "{}",
                render::render_text(&report, &db_path, rows, colours, bar_width)
            );
        }
        return;
    }

    // Live frame, cmduse's redraw contract: the frame's last line carries no
    // newline, so the cursor parks there and the countdown can rewrite that one
    // line each second instead of repainting the whole frame.
    let ink = render::Ink::new(colours);
    let mut out = std::io::stdout();
    let mut prev_lines = 0usize;
    let mut history: Vec<f64> = Vec::new();
    let mut last_five: Option<f64> = None;
    // Per-model cap-hit notifications: fire once on the rising edge into "over".
    let mut over: HashSet<String> = HashSet::new();
    let use_color = crate::render::color_enabled();
    loop {
        let report = build_at(window::now_ms());
        let (term_rows, cols) = crate::term_size().unwrap_or((0, 0));
        let cols_opt = (cols > 0).then_some(cols);
        let compact = compact_frame(term_rows, cols);
        // 5-hour spend only rises between refreshes, so the delta is the burst;
        // a sparkline of the cumulative figure would just stay full.
        let delta = last_five
            .map(|prev| (report.five_hour.cost - prev).max(0.0))
            .unwrap_or(0.0);
        last_five = Some(report.five_hour.cost);
        if burst_on {
            history.push(delta);
            if history.len() > burst_cap {
                history.remove(0);
            }
        }
        if notify_on_cap {
            let mut over_now: HashSet<String> = HashSet::new();
            for model in &report.models {
                if let Some(window) = window::over_window(model) {
                    over_now.insert(model.id.clone());
                    if !over.contains(&model.id) {
                        crate::notify::cap(
                            "ocuse: limit exceeded",
                            &format!("OpenCode Go {} is over its {window} limit", model.id),
                        );
                    }
                }
            }
            over = over_now;
        }
        let burst_slice: &[f64] = if burst_on { &history } else { &[] };
        let text = if compact {
            render::compact_line(&report, burst_slice, colours)
        } else {
            render::watch_frame(
                &report,
                &db_path,
                rows,
                colours,
                burst_slice,
                interval,
                bar_width,
            )
        };
        let update_box = update
            .as_ref()
            .map(|m| crate::render::update_box(m, cols_opt, use_color && !args.plain));
        let status = format!(
            "{}refreshing every {interval}s · ctrl-c to quit{}",
            ink.dim, ink.reset
        );
        let frame = match &update_box {
            Some(u) => format!("{u}{text}\n{status}"),
            None => format!("{text}\n{status}"),
        };
        prev_lines = crate::redraw_frame(&mut out, &frame, prev_lines, cols_opt);
        let _ = out.flush();
        for remaining in (1..interval).rev() {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let msg = format!(
                "\r\x1b[2K{}refreshing every {interval}s · next refresh in {remaining}s · ctrl-c to quit{}",
                ink.dim, ink.reset
            );
            let _ = write!(out, "{}", crate::clip_to_width(&msg, cols_opt));
            let _ = out.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> Vec<OsString> {
        std::iter::once(OsString::from("ocuse"))
            .chain(args.iter().map(OsString::from))
            .collect()
    }

    fn parse(args: &[&str]) -> cli::Args {
        cli::parse_args_from(argv(args), Binary::Ocuse).expect("parses")
    }

    #[test]
    fn json_and_one_shot_leave_the_watch_loop() {
        assert!(wants_watch(&parse(&[]))); // default: live frame
        assert!(wants_watch(&parse(&["-W"])));
        assert!(!wants_watch(&parse(&["-1"]))); // -1
        assert!(!wants_watch(&parse(&["--once"])));
        assert!(!wants_watch(&parse(&["--json"]))); // bare --json too
    }

    #[test]
    fn compact_frame_switches_on_small_terminals() {
        assert!(!compact_frame(40, 120)); // roomy
        assert!(compact_frame(10, 120)); // too few rows
        assert!(compact_frame(40, 30)); // too few columns
        assert!(!compact_frame(0, 0)); // unknown size: never compact
        assert!(compact_frame(0, 20)); // cols known, tiny
    }

    #[test]
    fn burst_state_derives_from_args_and_config() {
        // config off, no CLI flag → off
        assert_eq!(burst_config(None, false, 40), (false, 0));
        // CLI flag turns it on for the run, using its own sample count
        assert_eq!(burst_config(Some(30), false, 40), (true, 30));
        // config on → on with the configured samples
        assert_eq!(burst_config(None, true, 25), (true, 25));
        // CLI value wins over config's
        assert_eq!(burst_config(Some(60), true, 25), (true, 60));
        // a hand-edited config below the floor is clamped, like cmduse's
        assert_eq!(burst_config(None, true, 3), (true, 5));
    }

    #[test]
    fn gated_is_a_shared_flag() {
        // `--gated` filters `models` on both binaries, so it goes through the
        // shared parser instead of being lifted out of argv first.
        let a = cli::parse_args_from(argv(&["models", "--gated", "--plan", "go"]), Binary::Ocuse)
            .expect("parses");
        assert!(a.gated);
        assert_eq!(a.subcmd, Some(SubCmd::Models));
        assert_eq!(a.plan.as_deref(), Some("go"));
        assert!(
            !cli::parse_args_from(argv(&["models"]), Binary::Ocuse)
                .expect("parses")
                .gated
        );
    }

    #[test]
    fn output_fmt_maps_the_flags() {
        let of = |args: &[&str]| output_fmt(&parse(args));
        assert!(matches!(of(&[]), Fmt::Table));
        assert!(matches!(of(&["--json"]), Fmt::Json));
        assert!(matches!(of(&["--csv"]), Fmt::Csv));
    }

    #[test]
    fn model_id_is_pulled_out_before_parsing() {
        let (rest, id) = split_model_id(argv(&["model", "glm-5.3-flash"]));
        assert_eq!(id.as_deref(), Some("glm-5.3-flash"));
        // the id is gone; the rest still parses as the shared parser expects
        assert_eq!(
            cli::parse_args_from(rest, Binary::Ocuse).unwrap().subcmd,
            Some(SubCmd::Model)
        );

        // no id → the parser sees a bare `model`
        let (_, id) = split_model_id(argv(&["model"]));
        assert!(id.is_none());

        // a flag value that happens to be a word is not mistaken for the id
        let (rest, id) = split_model_id(argv(&["--plan", "go", "model", "glm-5.3-flash"]));
        assert_eq!(id.as_deref(), Some("glm-5.3-flash"));
        assert!(cli::parse_args_from(rest, Binary::Ocuse).is_ok());

        // value flags between `model` and the id are skipped, not consumed
        let (_, id) = split_model_id(argv(&["model", "--days", "7", "glm-5.3-flash"]));
        assert_eq!(id.as_deref(), Some("glm-5.3-flash"));

        // other commands pass through untouched
        let (_, id) = split_model_id(argv(&["daily", "--days", "7"]));
        assert!(id.is_none());
    }

    #[test]
    fn ocuse_reaches_shared_flag_parity() {
        // every shared flag cmduse's help prints is accepted by ocuse's parser
        for args in [
            vec!["-1"],
            vec!["-W"],
            vec!["-p"],
            vec!["-i", "30"],
            vec!["-w", "20"],
            vec!["-b", "40"],
            vec!["--json"],
            vec!["--csv"],
            vec!["--tz", "+05:30"],
            vec!["--days", "7"],
            vec!["--hours", "6"],
            vec!["--since", "2026-01-01T00:00:00Z"],
            vec!["--dismiss-update"],
            vec!["--gated"],
            vec!["config", "set", "interval=10"],
        ] {
            assert!(
                cli::parse_args_from(argv(&args), Binary::Ocuse).is_ok(),
                "ocuse must accept {args:?}"
            );
        }
        // `--local` stays cmduse-only (ocuse is always local); `--gated` is a
        // shared flag now, so it must parse for ocuse too.
        assert!(cli::parse_args_from(argv(&["--local"]), Binary::Ocuse).is_err());
        assert!(cli::parse_args_from(argv(&["--gated"]), Binary::Ocuse).is_ok());
    }

    #[test]
    fn ocuse_parses_every_shared_subcommand() {
        // The shared parser hands both binaries the same command surface,
        // including `models` (implemented for ocuse now).
        for (word, want) in [
            ("daily", SubCmd::Daily),
            ("days", SubCmd::Daily),
            ("hourly", SubCmd::Hours),
            ("hours", SubCmd::Hours),
            ("model", SubCmd::Model),
            ("session", SubCmd::Session),
            ("sessions", SubCmd::Session),
            ("project", SubCmd::Session),
            ("statusline", SubCmd::Statusline),
            ("models", SubCmd::Models),
            ("plans", SubCmd::Plans),
            ("mcp", SubCmd::Mcp),
        ] {
            for binary in [Binary::Cmduse, Binary::Ocuse] {
                let a = cli::parse_args_from(
                    std::iter::once(OsString::from("x"))
                        .chain(std::iter::once(OsString::from(word))),
                    binary,
                )
                .unwrap_or_else(|e| panic!("{binary:?} must parse {word}: {e}"));
                assert_eq!(a.subcmd.as_ref(), Some(&want), "{binary:?} {word}");
            }
        }
    }

    #[test]
    fn ocuse_help_carries_the_shared_tokens() {
        let c = cli::usage_text(Binary::Cmduse);
        let o = cli::usage_text(Binary::Ocuse);
        // every shared flag token cmduse prints appears in ocuse's help too
        for tok in [
            "-1",
            "--once",
            "-W",
            "--watch",
            "-p",
            "--plain",
            "-h",
            "--help",
            "-V",
            "--version",
            "--json",
            "--csv",
            "-i",
            "--interval",
            "-w",
            "--bar-width",
            "-b",
            "--bursts",
            "--days",
            "--since",
            "--hours",
            "--tz",
            "--dismiss-update",
            "NO_COLOR",
            "config set",
        ] {
            if c.contains(tok) {
                assert!(o.contains(tok), "ocuse help missing shared token {tok}");
            }
        }
    }
}
