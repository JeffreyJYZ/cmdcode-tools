use super::cli::{parse_args_from, parse_duration, parse_tz, usage_text, Binary, SubCmd};

fn argv(args: &[&str]) -> Vec<std::ffi::OsString> {
    // lexopt::from_iter wants the binary name first, like env::args_os.
    std::iter::once(std::ffi::OsString::from("cmduse"))
        .chain(args.iter().map(std::ffi::OsString::from))
        .collect()
}

/// Parse for the cmduse binary (the common case) with the helper above.
fn parse(args: &[&str]) -> Result<super::cli::Args, String> {
    parse_args_from(argv(args), Binary::Cmduse)
}

fn parse_ocuse(args: &[&str]) -> Result<super::cli::Args, String> {
    parse_args_from(argv(args), Binary::Ocuse)
}

#[test]
fn duration_suffixes() {
    assert_eq!(parse_duration("30"), Some(30));
    assert_eq!(parse_duration("30s"), Some(30));
    assert_eq!(parse_duration("5m"), Some(300));
    assert_eq!(parse_duration("1h"), Some(3600));
    assert_eq!(parse_duration("2d"), Some(172_800));
    assert_eq!(parse_duration("10S"), Some(10));
    assert_eq!(parse_duration(""), None);
    assert_eq!(parse_duration("abc"), None);
    assert_eq!(parse_duration("5x"), None);
}

#[test]
fn tz_offsets() {
    assert_eq!(parse_tz("+05:30"), Some(5 * 3600 + 30 * 60));
    assert_eq!(parse_tz("-08:00"), Some(-8 * 3600));
    assert_eq!(parse_tz("+0530"), Some(5 * 3600 + 30 * 60));
    assert_eq!(parse_tz("+8"), Some(8 * 3600));
    assert_eq!(parse_tz("05:30"), None); // missing sign
    assert_eq!(parse_tz("+15:00"), None); // out of range
    assert_eq!(parse_tz("+"), None);
}

#[test]
fn model_window_flags() {
    let a = parse(&["model", "--days", "30", "--json"]).unwrap();
    assert_eq!(a.subcmd, Some(SubCmd::Model));
    assert_eq!(a.last, Some(30));

    let b = parse(&["model", "--since", "2026-08-27T00:00:00Z"]).unwrap();
    assert_eq!(b.since.as_deref(), Some("2026-08-27T00:00:00Z"));

    // a bad timestamp fails at parse time, not silently at scan time
    assert!(parse(&["model", "--since", "yesterday"]).is_err());
}

#[test]
fn parses_flags_all_forms() {
    let a = parse(&["-1", "-i", "30s", "--tz", "+05:30", "--json"]).unwrap();
    assert!(a.once);
    assert_eq!(a.interval, Some(30));
    assert_eq!(a.tz, Some(19_800));
    assert!(a.json);
    // --key=value and attached short value both work through lexopt
    let a = parse(&["--interval=5m", "-w40"]).unwrap();
    assert_eq!(a.interval, Some(300));
    assert_eq!(a.bar_width, Some(40));
    let a = parse(&["daily", "--days", "3"]).unwrap();
    assert_eq!(a.subcmd, Some(SubCmd::Daily));
    assert_eq!(a.last, Some(3));
    let a = parse(&["model", "--csv"]).unwrap();
    assert!(a.csv);
    assert!(!a.json);
    assert!(parse(&["--json", "--csv"]).is_err());
}

#[test]
fn parses_config_set() {
    let a = parse(&["config", "set", "interval=10", "sl_colors=false"]).unwrap();
    let cs = a.config_set.unwrap();
    assert_eq!(cs.interval, Some(10));
    assert_eq!(cs.sl_colors, Some(false));
}

#[test]
fn rejects_bad_input() {
    assert!(parse(&["-1", "-W"]).is_err());
    assert!(parse(&["--tz", "junk"]).is_err());
    assert!(parse(&["-w", "3"]).is_err());
    assert!(parse(&["config", "set", "width=abc"]).is_err());
    assert!(parse(&["bogus"]).is_err());
}

#[test]
fn last_alias_and_clamps() {
    // --last and -l are aliases of --days
    assert_eq!(parse(&["daily", "--last", "5"]).unwrap().last, Some(5));
    assert_eq!(parse(&["daily", "-l", "5"]).unwrap().last, Some(5));
    // --days clamps into 1..=365
    assert_eq!(parse(&["daily", "--days", "0"]).unwrap().last, Some(1));
    assert_eq!(parse(&["daily", "--days", "9999"]).unwrap().last, Some(365));
    // --hours clamps into 1..=168
    assert_eq!(parse(&["hourly", "--hours", "0"]).unwrap().hours, Some(1));
    assert_eq!(
        parse(&["hourly", "--hours", "999"]).unwrap().hours,
        Some(168)
    );
}

#[test]
fn binary_gates_its_flags() {
    // cmduse rejects ocuse-only flags, ocuse rejects cmduse-only flags.
    for flag in ["--db", "--plan", "--window", "--period-start", "--rows"] {
        assert!(
            parse(&[flag, "x"]).is_err(),
            "cmduse must reject {flag} (present)"
        );
        assert!(parse(&[flag]).is_err(), "cmduse must reject {flag}");
    }
    assert!(parse(&["--infer-anniversary"]).is_err());
    assert!(parse_ocuse(&["--local"]).is_err());
    // `--gated` filters `models` on BOTH binaries — shared, not cmduse-only.
    assert!(parse_ocuse(&["models", "--gated"]).unwrap().gated);

    // the error carries the existing shape
    let e = parse_ocuse(&["--local"]).unwrap_err();
    assert_eq!(e, "unknown arg: --local (try --help)");
    let e = parse(&["--db", "x"]).unwrap_err();
    assert_eq!(e, "unknown arg: --db (try --help)");

    // and the owning binary accepts them
    let a = parse(&["--local", "--gated"]).unwrap();
    assert!(a.local && a.gated);
}

#[test]
fn ocuse_accepts_its_flags() {
    let a = parse_ocuse(&[
        "--db",
        "/tmp/opencode.db",
        "--plan",
        "go-plus",
        "--window",
        "30d",
        "--period-start",
        "2026-09-01",
        "--infer-anniversary",
        "--rows",
        "20",
    ])
    .unwrap();
    assert_eq!(a.binary, Binary::Ocuse);
    assert_eq!(a.db.as_deref(), Some("/tmp/opencode.db"));
    assert_eq!(a.plan.as_deref(), Some("go-plus"));
    assert_eq!(a.window.as_deref(), Some("30d"));
    assert_eq!(a.period_start.as_deref(), Some("2026-09-01"));
    assert!(a.infer_anniversary);
    assert_eq!(a.rows, Some(20));
    assert!(parse_ocuse(&["--rows", "x"]).is_err());
}

#[test]
fn parse_flags() {
    // usage text stays in sync with the parser's flags
    let u = usage_text(Binary::Cmduse);
    assert!(u.contains("--once"));
    assert!(u.contains("--interval"));
    assert!(u.contains("--bar-width"));
    assert!(u.contains("--plain"));
    assert!(u.contains("--csv"));
    assert!(u.contains("NO_COLOR"));
    assert!(u.contains("config set"));
    assert!(u.contains("config.json"));
}

#[test]
fn ocuse_help_is_the_shared_block_plus_extras() {
    let c = usage_text(Binary::Cmduse);
    let o = usage_text(Binary::Ocuse);
    // every shared token cmduse prints must also appear in ocuse's help
    let shared = [
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
        "--gated",
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
    ];
    for tok in shared {
        if c.contains(tok) {
            assert!(o.contains(tok), "ocuse help missing shared token {tok}");
        }
    }
    // ocuse's own extras and its own config path
    for tok in [
        "--db",
        "--plan",
        "--window",
        "--period-start",
        "--infer-anniversary",
        "--rows",
    ] {
        assert!(o.contains(tok), "ocuse help missing {tok}");
    }
    assert!(o.contains("ocuse/config.json"));
    assert!(c.contains("cmd-usage/config.json"));
}
