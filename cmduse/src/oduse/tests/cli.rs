// The CLI front-end: the flags oduse accepts, the ones it refuses, and the
// period resolution the window maths depends on.
use crate::cli;
use crate::oduse::args;
use crate::oduse::period;
use std::ffi::OsString;

fn argv(args: &[&str]) -> Vec<OsString> {
    std::iter::once(OsString::from("oduse"))
        .chain(args.iter().map(OsString::from))
        .collect()
}

fn parse(args: &[&str]) -> cli::Args {
    cli::parse_args_from(argv(args), cli::Binary::Oduse).expect("parses")
}

#[test]
fn oduse_accepts_its_flags() {
    let a = parse(&[
        "-1",
        "--db",
        "/tmp/app.sqlite",
        "--plan",
        "pro",
        "--window",
        "30d",
        "--period-start",
        "2026-09-01",
        "--rows",
        "20",
        "--no-wallet",
        "--json",
    ]);
    assert_eq!(a.binary, cli::Binary::Oduse);
    assert_eq!(a.db.as_deref(), Some("/tmp/app.sqlite"));
    assert_eq!(a.plan.as_deref(), Some("pro"));
    assert_eq!(a.window.as_deref(), Some("30d"));
    assert_eq!(a.period_start.as_deref(), Some("2026-09-01"));
    assert_eq!(a.rows, Some(20));
    assert!(a.no_wallet);
    // Flags another binary owns stay refused.
    assert!(cli::parse_args_from(argv(&["--gated"]), cli::Binary::Oduse).is_err());
    assert!(cli::parse_args_from(argv(&["--no-api"]), cli::Binary::Oduse).is_err());
    assert!(cli::parse_args_from(argv(&["--profile", "x"]), cli::Binary::Oduse).is_err());
    assert!(cli::parse_args_from(argv(&["--local"]), cli::Binary::Oduse).is_err());
    // …and oduse's own flag is not accepted by the others.
    assert!(cli::parse_args_from(argv(&["--no-wallet"]), cli::Binary::Ocuse).is_err());
}

#[test]
fn oduse_help_carries_the_shared_tokens() {
    let c = cli::usage_text(cli::Binary::Cmduse);
    let o = cli::usage_text(cli::Binary::Oduse);
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
        "--last",
        "-l",
        "--since",
        "--hours",
        "--tz",
        "--dismiss-update",
        "--rows",
        "NO_COLOR",
        "config set",
        "daily",
        "hourly",
        "model",
        "session",
        "statusline",
        "models",
        "plans",
        "mcp",
    ] {
        if c.contains(tok) {
            assert!(o.contains(tok), "oduse help missing shared token {tok}");
        }
    }
    for tok in [
        "--db",
        "--plan",
        "--no-wallet",
        "--window",
        "--period-start",
        "--infer-anniversary",
    ] {
        assert!(o.contains(tok), "oduse help missing {tok}");
    }
    assert!(o.contains("oduse/config.json"));
    // The source-forced absence is stated, not left for a reader to discover.
    assert!(!o.contains("--gated"), "oduse has no gating to filter");
}

#[test]
fn json_and_one_shot_leave_the_watch_loop() {
    assert!(args::wants_watch(&parse(&[])));
    assert!(!args::wants_watch(&parse(&["-1"])));
    assert!(!args::wants_watch(&parse(&["--once"])));
    assert!(!args::wants_watch(&parse(&["--json"])));
}

#[test]
fn burst_state_derives_from_args_and_config() {
    assert_eq!(args::burst_config(None, false, 40), (false, 0));
    assert_eq!(args::burst_config(Some(30), false, 40), (true, 30));
    assert_eq!(args::burst_config(None, true, 25), (true, 25));
    assert_eq!(args::burst_config(None, true, 3), (true, 5));
}

#[test]
fn output_fmt_maps_the_flags() {
    use crate::report_render::Fmt;
    assert!(matches!(args::output_fmt(&parse(&[])), Fmt::Table));
    assert!(matches!(args::output_fmt(&parse(&["--json"])), Fmt::Json));
    assert!(matches!(args::output_fmt(&parse(&["--csv"])), Fmt::Csv));
}

#[test]
fn model_id_is_pulled_out_before_parsing() {
    let (rest, id) = args::split_model_id(argv(&["model", "deepseek-v4.1-flash"]));
    assert_eq!(id.as_deref(), Some("deepseek-v4.1-flash"));
    assert_eq!(
        cli::parse_args_from(rest, cli::Binary::Oduse)
            .unwrap()
            .subcmd,
        Some(cli::SubCmd::Model)
    );
    let (_, id) = args::split_model_id(argv(&["model"]));
    assert!(id.is_none());
    // A value flag's value is not mistaken for the id.
    let (_, id) = args::split_model_id(argv(&["--plan", "go", "model", "glm-5.3-flash"]));
    assert_eq!(id.as_deref(), Some("glm-5.3-flash"));
    let (_, id) = args::split_model_id(argv(&["daily", "--days", "7"]));
    assert!(id.is_none());
}

#[test]
fn the_period_follows_the_familys_precedence() {
    let now = 1_800_000_000_000;
    // An explicit --since wins over everything.
    let a = parse(&["--since", "2026-09-01T00:00:00Z", "--window", "30d"]);
    let since = cmduse_core::dates::parse_iso_utc("2026-09-01T00:00:00Z").map(|ms| ms as i64);
    let p = period::resolve(&a, now, since).unwrap();
    assert_eq!(p.start, since);
    assert!(p.label.starts_with("since"));
    // Then --period-start.
    let a = parse(&["--period-start", "2026-09-01"]);
    let p = period::resolve(&a, now, None).unwrap();
    assert_eq!(p.start, period::parse_day("2026-09-01"));
    assert_eq!(p.label, "period start (pinned)");
    // Then the window mode.
    let a = parse(&[]);
    let p = period::resolve(&a, now, None).unwrap();
    assert_eq!(
        p.start,
        Some(crate::oduse::window::calendar_month_start(now))
    );
    assert_eq!(p.label, "calendar month");
    assert_eq!(p.mode, "month");
    let a = parse(&["--window", "all"]);
    let p = period::resolve(&a, now, None).unwrap();
    assert_eq!(p.start, Some(0));
    assert_eq!(period::end(0, "all", false), None);
    let a = parse(&["--window", "30d"]);
    let p = period::resolve(&a, now, None).unwrap();
    assert_eq!(p.start, Some(now - 30 * 86_400_000));
    assert_eq!(period::end(p.start.unwrap(), "30d", false), Some(now));
    // …and the inference leaves the start to the report.
    let a = parse(&["--infer-anniversary"]);
    let p = period::resolve(&a, now, None).unwrap();
    assert_eq!(p.start, None);
    assert!(p.inferred);
    assert_eq!(p.label, "subscription anniversary (inferred)");
    // A bad window is refused, not silently ignored.
    let a = parse(&["--window", "nope"]);
    assert!(period::resolve(&a, now, None).is_err());
    let a = parse(&["--period-start", "2026-13-01"]);
    assert!(period::resolve(&a, now, None).is_err());
}
