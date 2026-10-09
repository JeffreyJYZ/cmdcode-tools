// ocuse — OpenCode Go/Zen usage, same CLI shape as cmduse.
//
// Data: opencode's own store (read-only) plus the generated docs catalogue.
// There is no OpenCode usage API to ask (see core/zen.json's header and the
// README), so this reports what actually ran on this machine, priced by
// opencode itself, against the limits the docs publish.
//
// Lives in the library (not the bin) so `ocuse` and its `ocusedev` twin share
// one entry point: both bins are `fn main() { cmd_usage::ocuse::run(); }`.
use crate::ocuse::window;
use crate::ocuse::{build, db, mcp, render, zen};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

const HELP: &str = "\
ocuse — OpenCode Go/Zen usage (local, from opencode.db)

USAGE:
  ocuse                 watch: live frame, redrawn every 10s (colour + bars)
  ocuse -1              one-shot dashboard
  ocuse --json          machine-readable projection
  ocuse model [id]      per-model detail (all models when no id)
  ocuse daily [--days N]  spend per day
  ocuse hourly [--days N] spend per hour
  ocuse session          spend per session (newest first)
  ocuse plans           the Go/Zen catalogue: limits and rates
  ocuse statusline      one compact line
  ocuse mcp             MCP stdio server (usage/plans/daily/hourly/session/model)

FLAGS:
  --db <path>           opencode store (default $OPENCODE_DB or ~/.local/share/opencode/opencode.db)
  --days <n>            how many days of history to read (default 120)
  --window <w>          report window: month (default, calendar month UTC), all, or <n>d
  --period-start <date>  pin the period start (YYYY-MM-DD, UTC)
  --infer-anniversary   infer the period start from the first Go request instead
  --rows <n>            table rows to print (default 15)
  --plain               no colour (also off for NO_COLOR or a non-tty)
  --tz <offset>         display timezone for day/hour buckets (e.g. +05:30)
  -h, --help            this text
  -V, --version         version
";

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

/// `+05:30` / `-08:00` -> seconds east of UTC. Also accepts `+0530`.
fn parse_tz(value: &str) -> Option<i64> {
    let (sign, rest) = match value.as_bytes().first()? {
        b'+' => (1, &value[1..]),
        b'-' => (-1, &value[1..]),
        _ => return None,
    };
    let (hours, minutes) = if let Some((h, m)) = rest.split_once(':') {
        (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?)
    } else if rest.len() == 4 {
        (
            rest[..2].parse::<i64>().ok()?,
            rest[2..].parse::<i64>().ok()?,
        )
    } else {
        return None;
    };
    (hours <= 14 && minutes < 60).then_some(sign * (hours * 3600 + minutes * 60))
}

/// Colour follows cmduse: off for `--plain`, `NO_COLOR`, or a non-tty stdout.
fn colour_enabled(plain: bool) -> bool {
    use std::io::IsTerminal;
    !plain
        && std::env::var("NO_COLOR")
            .map(|v| v.is_empty())
            .unwrap_or(true)
        && std::io::stdout().is_terminal()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The live watch loop is the default command, but `-1` / `--once` / `--json`
/// all want a single frame printed and an exit. A bare `--json` used to fall
/// into the loop and print no JSON at all: the JSON branch lives in the
/// catch-all arm, and `watch` is what an absent command word resolves to.
fn wants_live_watch(command: &str, one_shot: bool, once: bool, json: bool) -> bool {
    command == "watch" && !one_shot && !once && !json
}

pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        print!("{HELP}");
        return;
    }
    if args.iter().any(|a| a == "-V" || a == "--version") {
        println!("ocuse {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let value = |flag: &str| -> Option<String> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let flag = |name: &str| args.iter().any(|a| a == name);
    let db_path = value("--db").unwrap_or_else(db::default_path);
    let days: i64 = value("--days").and_then(|v| v.parse().ok()).unwrap_or(120);
    let rows: usize = value("--rows").and_then(|v| v.parse().ok()).unwrap_or(15);
    let now = now_ms();
    let since = now - days * 86_400_000;
    // The period: explicit start > window mode > calendar month. Inference from
    // the first Go request is opt-in because it guesses badly on sparse history
    // (an account whose usage starts mid-cycle infers the wrong anniversary).
    let tz_secs = match value("--tz") {
        None => 0,
        Some(tz) => parse_tz(&tz).unwrap_or_else(|| {
            eprintln!("ocuse: --tz expects an offset like +05:30 or -08:00");
            std::process::exit(2);
        }),
    };
    let colour = colour_enabled(flag("--plain"));
    let window_mode = value("--window").unwrap_or_else(|| "month".into());
    let period_start = if let Some(day) = value("--period-start").and_then(|v| parse_day(&v)) {
        Some(day)
    } else if window_mode == "all" {
        Some(0)
    } else if window_mode == "month" {
        Some(window::calendar_month_start(now))
    } else if let Some(days) = window_mode
        .strip_suffix('d')
        .and_then(|v| v.parse::<i64>().ok())
    {
        Some(now - days * 86_400_000)
    } else {
        eprintln!("ocuse: --window expects month, all, or <n>d (got {window_mode})");
        std::process::exit(2);
    };

    // First non-flag argument that is not a flag's value is the command
    // (`--window all daily` must mean `daily`, not `all`).
    let value_flags = [
        "--db",
        "--days",
        "--rows",
        "--window",
        "--period-start",
        "--tz",
    ];
    let mut consumed = vec![false; args.len()];
    for (i, arg) in args.iter().enumerate() {
        if value_flags.contains(&arg.as_str()) && i + 1 < args.len() {
            consumed[i + 1] = true;
        }
    }
    let command = args
        .iter()
        .enumerate()
        .find(|(i, a)| !consumed[*i] && !a.starts_with('-'))
        .map(|(_, a)| a.clone())
        .unwrap_or_else(|| "watch".to_string());

    // `plans` needs no database at all.
    if command == "plans" {
        print!("{}", render::plans_text(colour));
        return;
    }

    let period_label = if flag("--period-start") {
        "period start (pinned)".to_string()
    } else {
        match window_mode.as_str() {
            "all" => "all time".to_string(),
            "month" => "calendar month".to_string(),
            other => other.to_string(),
        }
    };
    let infer = flag("--infer-anniversary");
    let period_start = if infer && !flag("--period-start") {
        None
    } else {
        period_start
    };
    let read = || match db::read_rows(&db_path, since) {
        Ok(rows) => rows,
        Err(error) => {
            eprintln!("ocuse: {error}");
            eprintln!("hint: --db <path>, or OPENCODE_DB; the store is created by opencode itself");
            std::process::exit(1);
        }
    };

    let catalog = zen::catalog();
    match command.as_str() {
        "statusline" => {
            let mut report = build(&read(), &catalog, now, period_start);
            report.period_label = period_label;
            println!("{}", render::status_line(&report, colour));
        }
        "daily" => print!(
            "{}",
            render::bucket_text(&read(), now, days, 86_400_000, "day", tz_secs, colour)
        ),
        "hourly" => print!(
            "{}",
            render::bucket_text(&read(), now, days, 3_600_000, "hour", tz_secs, colour)
        ),
        "session" => print!("{}", render::session_text(&read(), 20, colour)),
        "mcp" => {
            // stdio JSON-RPC; stdout carries protocol only, so nothing else may print.
            mcp::run(&db_path, days, tz_secs, false, period_start);
        }
        "model" => {
            let wanted = args
                .iter()
                .position(|a| a == "model")
                .and_then(|i| args.get(i + 1))
                .filter(|v| !v.starts_with('-'))
                .cloned();
            let mut report = build(&read(), &catalog, now, period_start);
            report.period_label = period_label;
            match wanted {
                Some(id) => print!("{}", render::model_text(&report, &id, colour)),
                None => print!(
                    "{}",
                    render::render_text(&report, &db_path, usize::MAX, colour)
                ),
            }
        }
        "watch" if wants_live_watch(&command, flag("-1"), flag("--once"), flag("--json")) => {
            // Live frame, cmduse's redraw contract: the frame's last line carries
            // no newline, so the cursor parks there and the countdown can rewrite
            // that one line each second instead of repainting the whole frame.
            const INTERVAL: u64 = 10;
            const BURST_SAMPLES: usize = 60;
            let ink = render::Ink::new(colour);
            let mut out = std::io::stdout();
            let mut prev_lines = 0usize;
            let mut history: Vec<f64> = Vec::new();
            let mut last_five: Option<f64> = None;
            loop {
                let report = build(&read(), &catalog, now_ms(), period_start);
                let (_, cols) = crate::term_size().unwrap_or((0, 0));
                let cols = (cols > 0).then_some(cols);
                // 5-hour spend only rises between refreshes, so the delta is the
                // burst; a sparkline of the cumulative figure would just stay full.
                let delta = last_five
                    .map(|prev| (report.five_hour.cost - prev).max(0.0))
                    .unwrap_or(0.0);
                last_five = Some(report.five_hour.cost);
                history.push(delta);
                if history.len() > BURST_SAMPLES {
                    history.remove(0);
                }
                let status = format!(
                    "{}refreshing every {INTERVAL}s · ctrl-c to quit{}",
                    ink.dim, ink.reset
                );
                let frame = format!(
                    "{}\n{status}",
                    render::watch_frame(&report, &db_path, rows, colour, &history, INTERVAL)
                );
                prev_lines = crate::redraw_frame(&mut out, &frame, prev_lines, cols);
                let _ = out.flush();
                for remaining in (1..INTERVAL).rev() {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let msg = format!(
                        "\r\x1b[2K{}refreshing every {INTERVAL}s · next refresh in {remaining}s · ctrl-c to quit{}",
                        ink.dim, ink.reset
                    );
                    let _ = write!(out, "{}", crate::clip_to_width(&msg, cols));
                    let _ = out.flush();
                }
            }
        }
        _ => {
            let mut report = build(&read(), &catalog, now, period_start);
            report.period_label = period_label;
            if flag("--json") {
                println!("{}", render::render_json(&report));
            } else {
                print!("{}", render::render_text(&report, &db_path, rows, colour));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::wants_live_watch;

    #[test]
    fn json_and_one_shot_leave_the_watch_loop() {
        assert!(wants_live_watch("watch", false, false, false));
        assert!(!wants_live_watch("watch", true, false, false)); // -1
        assert!(!wants_live_watch("watch", false, true, false)); // --once
        assert!(!wants_live_watch("watch", false, false, true)); // --json
        assert!(!wants_live_watch("usage", false, false, false));
    }
}
