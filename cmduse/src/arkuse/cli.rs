// arkuse — Volcengine ARK Agent Plan usage, same CLI shape as cmduse and ocuse.
//
// Data: `arkcli`'s control-plane meters (the console's own 5-hour / weekly /
// monthly figures, via `arkuse::api`), opencode's store read for `agent-plan`
// rows only (per-model attribution, `arkuse::db`), and the hand-maintained
// catalogue in `core/ark.json` (`arkuse::ark`).
//
// The unit is AFP, the plan's own currency: 1 AFP = ¥0.002 at every tier. This
// binary never prints dollars, and never uses opencode's recorded `cost` — ARK
// is subscription-billed, so the store holds tokens and no money that applies to
// this plan.
//
// The front-end is shared: `cmduse/src/cli.rs` parses argv for all three
// binaries, `config.rs` owns the config files, `notify.rs` the desktop notice,
// `update_check.rs` the crates.io line. Lives in the library so `arkuse` and its
// `arkusedev` twin share one entry point.
use crate::arkuse::{api, ark, build, db, mcp, render, window};
use crate::cli::{self, Binary, SubCmd};
use crate::report_render::Fmt;
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::Write;

/// `YYYY-MM-DD` -> epoch ms at 00:00 UTC.
fn parse_day(value: &str) -> Option<i64> {
    let mut parts = value.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let d: i64 = parts.next()?.parse().ok()?;
    (1..=12).contains(&m).then_some(())?;
    (1..=31).contains(&d).then_some(())?;
    Some(window::days_from_civil(y, m, d) * 86_400_000)
}

/// Flags whose value is the next argv token (mirrors the shared parser).
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
    "--profile",
    "--window",
    "--period-start",
    "--rows",
];

/// `arkuse model <id>` takes a positional model id the shared parser (written
/// for cmduse, whose `model` takes none) rejects, so pull it out first.
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

/// The live watch loop is the default, but `-1`/`--once` and `--json` want a
/// single frame and an exit.
fn wants_watch(args: &cli::Args) -> bool {
    !args.once && !args.json
}

/// cmduse's small-terminal rule: one clipped line instead of the full frame.
fn compact_frame(rows: usize, cols: usize) -> bool {
    cols > 0 && (rows < 16 || cols < 40)
}

/// Spend-burst sparkline derivation, identical to cmduse's and ocuse's.
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

/// The period's end (epoch ms), resolved from the report's own start so an
/// inferred anniversary gets one too. `--window all` has no boundary.
fn period_end(report: &window::Report, window_mode: &str, inferred: bool) -> Option<i64> {
    if inferred {
        return Some(window::next_month(report.since_ms));
    }
    if window_mode == "all" {
        None
    } else if let Some(d) = window_mode
        .strip_suffix('d')
        .and_then(|v| v.parse::<i64>().ok())
    {
        Some(report.since_ms + d * 86_400_000)
    } else {
        Some(window::next_month(report.since_ms))
    }
}

pub fn run() {
    let (argv, model_id) = split_model_id(std::env::args_os().collect());
    let args = match cli::parse_args_from(argv, Binary::Arkuse) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if args.help {
        cli::usage(Binary::Arkuse);
        return;
    }
    if let Some(cs) = args.config_set {
        if let Err(e) = crate::config::set(Binary::Arkuse, &cs) {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
        return;
    }
    if args.dismiss_update {
        match crate::update_check::latest_newer() {
            Ok(Some(v)) => match crate::config::set_dismissed(Binary::Arkuse, &v) {
                Ok(()) => println!("dismissed update notice for {v}"),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            },
            Ok(None) => println!("arkuse is up to date ({})", env!("CARGO_PKG_VERSION")),
            Err(e) => {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let cfg = crate::config::load(Binary::Arkuse);
    let colours = !args.plain && crate::render::color_enabled();
    let fmt = output_fmt(&args);
    let db_path = args.db.clone().unwrap_or_else(db::default_path);
    let days: i64 = args.last.unwrap_or(120) as i64;
    let hours: i64 = args.hours.unwrap_or(24) as i64;
    let rows: usize = args.rows.unwrap_or(15);
    let now = window::now_ms();
    let tz_secs = args.tz.unwrap_or(0);

    // `plans` needs neither the store nor a profile: the catalogue is static.
    if let Some(SubCmd::Plans) = args.subcmd {
        if args.json {
            print!("{}", render::plans_json());
        } else {
            print!("{}", render::plans_text(colours));
        }
        return;
    }

    // The profile names both the control-plane account and its tier. `--no-api`
    // is a promise not to shell out at all, so the tier then comes only from
    // `--plan` (else the catalogue default) and no profile is resolved.
    let resolved = if args.no_api {
        None
    } else {
        api::resolve(args.profile.as_deref())
    };
    let profile = args
        .profile
        .clone()
        .or_else(|| {
            std::env::var("ARKUSE_PROFILE")
                .ok()
                .filter(|v| !v.is_empty())
        })
        .or_else(|| resolved.as_ref().map(|(name, _)| name.clone()));
    let tier = args
        .plan
        .clone()
        .or_else(|| resolved.as_ref().and_then(|(_, tier)| tier.clone()))
        .unwrap_or_else(|| ark::DEFAULT_PLAN.to_string());
    let catalog = ark::catalog();
    if catalog.plan(&tier).is_none() {
        eprintln!(
            "arkuse: --plan expects one of {} (got {tier})",
            catalog.plan_ids().join(", ")
        );
        std::process::exit(2);
    }

    // `models` is the catalogue joined with one tier's grants: no store read.
    if let Some(SubCmd::Models) = args.subcmd {
        if args.json {
            print!("{}", render::models_json(&tier, args.gated));
        } else {
            print!("{}", render::models_text(&tier, args.gated, colours));
        }
        return;
    }

    // `--since` (ISO-8601) pins the report window for model/session, as in the
    // other two binaries; `parse_iso_utc` yields epoch milliseconds.
    let since_override = args
        .since
        .as_deref()
        .and_then(cmduse_core::dates::parse_iso_utc)
        .map(|ms| ms as i64);

    // The period: explicit start > window mode > calendar month. Inference from
    // the first `agent-plan` request is opt-in because a sparse history guesses
    // the wrong anniversary.
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
        eprintln!("arkuse: --window expects month, all, or <n>d (got {window_mode})");
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
    let period_inferred = period_start.is_none();

    // The control plane's meters. A missing profile, a missing `arkcli`, or a
    // refused call leaves `None` and a named reason; every window row then falls
    // back to the local estimate, labelled as such.
    let fetch_account = || -> Result<api::Usage, api::Unavailable> {
        if args.no_api {
            return Err(api::Unavailable::Disabled);
        }
        match &profile {
            Some(name) => api::fetch(name),
            None => Err(api::Unavailable::NoProfile),
        }
    };
    let (mut account, mut account_error) = match fetch_account() {
        Ok(usage) => (Some(usage), None),
        Err(why) => (None, Some(why.reason())),
    };
    // The meter knows the billing anniversary; the calendar month is a guess, and
    // slicing by it would disagree with the monthly meter printed beside it. So
    // when the endpoint answered and nothing pinned the period, take the
    // account's own month: ARK resets at 23:59:59 of the anniversary day, in the
    // server's offset, so the start is 00:00 on that day-of-month one month back.
    let account_month = account.as_ref().and_then(|a| {
        let reset = a.monthly.reset_ms()?;
        Some((
            window::month_start_before(reset, a.monthly.offset_secs()),
            reset,
        ))
    });
    let account_month = if window_mode == "month"
        && !period_inferred
        && since_override.is_none()
        && args.period_start.is_none()
    {
        account_month
    } else {
        None
    };
    let period_start = account_month.map(|(start, _)| start).or(period_start);
    let period_label = match account_month {
        Some(_) => "Agent Plan billing month".to_string(),
        None => period_label,
    };

    let read_since = |since_ms: i64| match db::read_all(&db_path, since_ms) {
        Ok(rows) => rows,
        Err(error) => {
            eprintln!("arkuse: {error}");
            eprintln!("hint: --db <path>, or OPENCODE_DB; the store is created by opencode itself");
            std::process::exit(1);
        }
    };
    // The report's own read window: an explicit --since pins it, else --days.
    let report_window = since_override.unwrap_or(now - days * 86_400_000);
    let build_at = |t: i64, account: Option<&api::Usage>, account_error: Option<&str>| {
        let mut report = build(
            &read_since(report_window),
            &catalog,
            &tier,
            t,
            period_start,
            account,
        );
        report.period_label = period_label.clone();
        report.account = account.cloned();
        report.account_error = account_error.map(str::to_string);
        report.tier = tier.clone();
        report.profile = profile.clone();
        report.period_end_ms = account_month
            .map(|(_, reset)| reset)
            .or_else(|| period_end(&report, &window_mode, period_inferred));
        report
    };

    match args.subcmd {
        Some(SubCmd::Statusline) => {
            let report = build_at(now, account.as_ref(), account_error.as_deref());
            if args.json {
                println!("{}", render::statusline_json(&report, &tier));
            } else {
                print!(
                    "{}",
                    render::statusline_template(
                        &report,
                        &tier,
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
                    &catalog,
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
                    &catalog,
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
                render::session_text(
                    &read_since(report_window),
                    &catalog,
                    args.rows_cap(20),
                    colours,
                    fmt
                )
            );
            return;
        }
        Some(SubCmd::Mcp) => {
            // stdio JSON-RPC; stdout carries protocol only, so nothing else may print.
            mcp::run(mcp::Settings {
                db_path: &db_path,
                days,
                tz_secs,
                colour: false,
                tier: &tier,
                period_start,
                account_month,
                account: account.as_ref(),
                account_error: account_error.as_deref(),
            });
            return;
        }
        Some(SubCmd::Model) => {
            let report = build_at(now, account.as_ref(), account_error.as_deref());
            if fmt == Fmt::Table {
                match &model_id {
                    Some(id) => print!("{}", render::model_text(&report, id, colours)),
                    None => print!(
                        "{}",
                        render::models_period_text(&report, args.rows_cap(usize::MAX), colours)
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
    // redrawn frame; one-shot has no frame, so it goes to stderr.
    let update =
        crate::update_check::check_sync(cfg.check_updates, cfg.dismissed_update.as_deref());

    if !wants_watch(&args) {
        if let Some(msg) = &update {
            eprintln!("{msg}");
        }
        let report = build_at(now, account.as_ref(), account_error.as_deref());
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
    // newline, so the cursor parks there and the countdown rewrites that one line
    // each second instead of repainting the whole frame.
    let ink = render::Ink::new(colours);
    let mut out = std::io::stdout();
    let mut prev_lines = 0usize;
    let mut history: Vec<f64> = Vec::new();
    let mut last_five: Option<f64> = None;
    // Window cap-hit notifications: fire once on the rising edge into "over".
    // ARK limits the plan's windows, not any one model, so the meters are the
    // only source with a verdict.
    let mut over: HashSet<String> = HashSet::new();
    let use_color = crate::render::color_enabled();
    loop {
        // Re-ask each tick, keeping the last answer through a blip so the frame
        // cannot flip between the meters and the local estimate. A blip's reason
        // is dropped with it: the rows on screen are still the account's.
        match fetch_account() {
            Ok(fresh) => {
                account = Some(fresh);
                account_error = None;
            }
            Err(why) => {
                if account.is_none() {
                    account_error = Some(why.reason());
                }
            }
        }
        let report = build_at(window::now_ms(), account.as_ref(), account_error.as_deref());
        let (term_rows, cols) = crate::term_size().unwrap_or((0, 0));
        let cols_opt = (cols > 0).then_some(cols);
        let compact = compact_frame(term_rows, cols);
        // The 5-hour figure only rises between refreshes, so the delta is the
        // burst; a sparkline of the cumulative figure would just stay full.
        let delta = last_five
            .map(|prev| (report.five_hour.afp - prev).max(0.0))
            .unwrap_or(0.0);
        last_five = Some(report.five_hour.afp);
        if burst_on {
            history.push(delta);
            if history.len() > burst_cap {
                history.remove(0);
            }
        }
        if notify_on_cap {
            let mut over_now: HashSet<String> = HashSet::new();
            if let Some(a) = &account {
                for (key, label, meter) in [
                    ("window:5h", "5-hour window", &a.five_hour),
                    ("window:wk", "weekly window", &a.weekly),
                    ("window:mo", "monthly quota", &a.monthly),
                ] {
                    if meter.exceeded() {
                        over_now.insert(key.to_string());
                        if !over.contains(key) {
                            crate::notify::cap(
                                "arkuse: limit exceeded",
                                &format!("ARK Agent Plan {label} is over its limit"),
                            );
                        }
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
        std::iter::once(OsString::from("arkuse"))
            .chain(args.iter().map(OsString::from))
            .collect()
    }

    fn parse(args: &[&str]) -> cli::Args {
        cli::parse_args_from(argv(args), Binary::Arkuse).expect("parses")
    }

    #[test]
    fn json_and_one_shot_leave_the_watch_loop() {
        assert!(wants_watch(&parse(&[])));
        assert!(wants_watch(&parse(&["-W"])));
        assert!(!wants_watch(&parse(&["-1"])));
        assert!(!wants_watch(&parse(&["--once"])));
        assert!(!wants_watch(&parse(&["--json"])));
    }

    #[test]
    fn compact_frame_switches_on_small_terminals() {
        assert!(!compact_frame(40, 120));
        assert!(compact_frame(10, 120));
        assert!(compact_frame(40, 30));
        assert!(!compact_frame(0, 0));
    }

    #[test]
    fn burst_state_derives_from_args_and_config() {
        assert_eq!(burst_config(None, false, 40), (false, 0));
        assert_eq!(burst_config(Some(30), false, 40), (true, 30));
        assert_eq!(burst_config(None, true, 25), (true, 25));
        assert_eq!(burst_config(Some(60), true, 25), (true, 60));
        assert_eq!(burst_config(None, true, 3), (true, 5));
    }

    #[test]
    fn the_ark_flags_are_shared_and_the_profile_is_ark_only() {
        let a = parse(&["models", "--gated", "--plan", "large", "--profile", "p"]);
        assert!(a.gated);
        assert_eq!(a.subcmd, Some(SubCmd::Models));
        assert_eq!(a.plan.as_deref(), Some("large"));
        assert_eq!(a.profile.as_deref(), Some("p"));
        // The tier flag exists for ocuse too; the profile does not — ocuse's
        // credential is the opencode store.
        assert!(cli::parse_args_from(argv(&["--profile", "p"]), Binary::Ocuse).is_err());
    }

    #[test]
    fn no_api_is_available_to_arkuse_too() {
        assert!(parse(&["-1", "--no-api"]).no_api);
        assert!(!parse(&["-1"]).no_api);
    }

    #[test]
    fn output_fmt_maps_the_flags() {
        let of = |args: &[&str]| output_fmt(&parse(args));
        assert!(matches!(of(&[]), Fmt::Table));
        assert!(matches!(of(&["--json"]), Fmt::Json));
        assert!(matches!(of(&["--csv"]), Fmt::Csv));
    }

    #[test]
    fn period_end_resolves_from_the_reports_own_start() {
        let since = window::days_from_civil(2026, 9, 15) * 86_400_000;
        let report = window::Report {
            period_label: "calendar month".into(),
            now_ms: since,
            since_ms: since,
            period_end_ms: None,
            month_inferred: false,
            account: None,
            account_error: None,
            clients: Vec::new(),
            tier: "medium".into(),
            profile: None,
            offset_secs: 0,
            five_hour: Default::default(),
            weekly: Default::default(),
            month: Default::default(),
            daily: None,
            models: Vec::new(),
        };
        assert_eq!(
            period_end(&report, "month", false),
            Some(window::next_month(since))
        );
        assert_eq!(
            period_end(&report, "30d", false),
            Some(since + 30 * 86_400_000)
        );
        assert_eq!(period_end(&report, "all", false), None);
        assert_eq!(
            period_end(&report, "30d", true),
            Some(window::next_month(since))
        );
    }

    #[test]
    fn split_model_id_lifts_only_the_positional_after_model() {
        let (rest, id) = split_model_id(argv(&["model", "deepseek-v4.1-flash", "-1"]));
        assert_eq!(id.as_deref(), Some("deepseek-v4.1-flash"));
        assert_eq!(rest.len(), 3, "the id is gone, the flags and argv[0] stay");
        assert_eq!(rest[2], OsString::from("-1"));
        // A flag value that looks like an id is not one.
        let (_, id) = split_model_id(argv(&["--plan", "medium", "model"]));
        assert_eq!(id, None);
    }
}
