// `--days` on `model`: the regression that `oduse model --days N` was inert.
//
// The window was pinned to the period start (the calendar month), so `--days 365`
// read a year of rows and then counted only the current month (`n:0` where
// `--since` gave `n:1`). `--days` is now a window of its own for `model`, and a
// read cutoff only for every other command, which is what their help says.
use crate::cli;
use crate::oduse::period;
use std::ffi::OsString;

fn parse(args: &[&str]) -> cli::Args {
    cli::parse_args_from(
        std::iter::once(OsString::from("oduse")).chain(args.iter().map(OsString::from)),
        cli::Binary::Oduse,
    )
    .expect("parses")
}

const NOW: i64 = 1_800_000_000_000;
const DAY: i64 = 86_400_000;

#[test]
fn model_days_is_a_window_of_its_own() {
    let p = period::resolve(&parse(&["model", "--days", "365"]), NOW, None).unwrap();
    assert_eq!(p.start, Some(NOW - 365 * DAY));
    assert_eq!(p.label, "last 365d");
    assert_eq!(p.mode, "365d");
    // The window's end resolves from its own start, so the frame's bounds agree.
    assert_eq!(period::end(NOW - 365 * DAY, &p.mode, false), Some(NOW));
}

#[test]
fn model_days_does_not_outrank_an_explicit_window() {
    // `--window all` still means all time, and `--period-start` still pins, even
    // with `--days` on the same command line.
    let p = period::resolve(
        &parse(&["model", "--days", "7", "--window", "all"]),
        NOW,
        None,
    )
    .unwrap();
    assert_eq!(p.start, Some(0));
    let p = period::resolve(
        &parse(&["model", "--days", "7", "--period-start", "2026-09-01"]),
        NOW,
        None,
    )
    .unwrap();
    assert_eq!(p.start, period::parse_day("2026-09-01"));
    // …and `--since` outranks it, as everywhere else.
    let since = cmduse_core::dates::parse_iso_utc("2026-01-01T00:00:00Z").map(|ms| ms as i64);
    let p = period::resolve(
        &parse(&["model", "--since", "2026-01-01T00:00:00Z", "--days", "7"]),
        NOW,
        since,
    )
    .unwrap();
    assert_eq!(p.start, since);
}

#[test]
fn days_is_only_a_window_for_model() {
    // Every other command reads `--days` as its read cutoff (`daily` buckets by
    // it), so the period keeps the calendar month there.
    for cmd in ["daily", "hourly", "session", ""] {
        let mut args = vec![cmd];
        args.extend(["--days", "365"]);
        let args: Vec<&str> = args.into_iter().filter(|a| !a.is_empty()).collect();
        let p = period::resolve(&parse(&args), NOW, None).unwrap();
        assert_eq!(
            p.start,
            Some(crate::oduse::window::calendar_month_start(NOW)),
            "{cmd:?} keeps the calendar month"
        );
    }
}
