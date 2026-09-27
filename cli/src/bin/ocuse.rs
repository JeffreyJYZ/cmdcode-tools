// ocuse — OpenCode Go/Zen usage, same CLI shape as cmduse.
//
// Data: opencode's own store (read-only) plus the generated docs catalogue.
// There is no OpenCode usage API to ask (see core/zen.json's header and the
// README), so this reports what actually ran on this machine, priced by
// opencode itself, against the limits the docs publish.
use cmd_usage::ocuse::{build, db, render, zen};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

const HELP: &str = "\
ocuse — OpenCode Go/Zen usage (local, from opencode.db)

USAGE:
  ocuse                 watch: redraw the dashboard every 10s
  ocuse -1              one-shot dashboard
  ocuse --json          machine-readable projection
  ocuse model [id]      per-model detail (all models when no id)
  ocuse daily [--days N]  spend per day
  ocuse hourly [--days N] spend per hour
  ocuse session          spend per session (newest first)
  ocuse plans           the Go/Zen catalogue: limits and rates
  ocuse statusline      one compact line

FLAGS:
  --db <path>           opencode store (default $OPENCODE_DB or ~/.local/share/opencode/opencode.db)
  --days <n>            how many days of history to read (default 120)
  --window <w>          report window: month (default, calendar month UTC), all, or <n>d
  --period-start <date>  pin the period start (YYYY-MM-DD, UTC)
  --infer-anniversary   infer the period start from the first Go request instead
  --rows <n>            table rows to print (default 15)
  --plain               no colour (accepted for cmduse parity)
  --tz <offset>         display timezone (accepted; day buckets are UTC for now)
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
    Some(cmd_usage::ocuse::window::days_from_civil(y, m, d) * 86_400_000)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn main() {
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
    let window_mode = value("--window").unwrap_or_else(|| "month".into());
    let period_start = if let Some(day) = value("--period-start").and_then(|v| parse_day(&v)) {
        Some(day)
    } else if window_mode == "all" {
        Some(0)
    } else if window_mode == "month" {
        Some(cmd_usage::ocuse::window::calendar_month_start(now))
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
        print!("{}", plans_text());
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
            println!("{}", render::status_line(&report));
        }
        "daily" => print!("{}", bucket_text(&read(), now, days, 86_400_000, "day")),
        "hourly" => print!("{}", bucket_text(&read(), now, days, 3_600_000, "hour")),
        "session" => print!("{}", session_text(&read(), 20)),
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
                Some(id) => print!("{}", model_text(&report, &id)),
                None => print!("{}", render::render_text(&report, &db_path, usize::MAX)),
            }
        }
        "watch" if !flag("-1") && !flag("--once") => loop {
            let report = build(&read(), &catalog, now_ms(), period_start);
            print!(
                "\x1b[2J\x1b[H{}",
                render::render_text(&report, &db_path, rows)
            );
            let _ = std::io::stdout().flush();
            std::thread::sleep(std::time::Duration::from_secs(10));
        },
        _ => {
            let mut report = build(&read(), &catalog, now, period_start);
            report.period_label = period_label;
            if flag("--json") {
                println!("{}", render::render_json(&report));
            } else {
                print!("{}", render::render_text(&report, &db_path, rows));
            }
        }
    }
}

/// The catalogue: what each product costs and (for Go) what it allows.
fn plans_text() -> String {
    let catalog = zen::catalog();
    let mut out = format!(
        "OpenCode plans (docs, extracted {})\n\nGO — ${:.2}/month · windows: 5h {:.0}% · weekly {:.0}% · monthly {:.0}%\n",
        catalog.extracted_at,
        catalog.go.price_usd,
        catalog.go.window_share.five_hour * 100.0,
        catalog.go.window_share.weekly * 100.0,
        catalog.go.window_share.monthly * 100.0,
    );
    out.push_str("MODEL                            LIMIT    IN     OUT    CACHE\n");
    for model in &catalog.go.models {
        let rate = model.variants.first();
        out.push_str(&format!(
            "{:<28} {:>7} {:>6} {:>6} {:>8}\n",
            model.id,
            model
                .monthly_limit
                .map(cmduse_core::money)
                .unwrap_or_else(|| "—".into()),
            rate.map(|r| format!("${}", r.input)).unwrap_or_default(),
            rate.map(|r| format!("${}", r.output)).unwrap_or_default(),
            rate.map(|r| format!("${}", r.cache_read))
                .unwrap_or_default(),
        ));
    }
    out.push_str(&format!(
        "\nZEN — pay-as-you-go, {} models priced per 1M tokens\n",
        catalog.zen.models.len()
    ));
    out
}

fn model_text(report: &cmd_usage::ocuse::Report, id: &str) -> String {
    match report.models.iter().find(|m| m.id == id) {
        Some(model) => format!(
            "{} ({})\n  limit     {}\n  month     {} · {} requests\n  5-hour    {}\n  weekly    {}\n",
            model.id,
            model.provider,
            model.limit.map(cmduse_core::money).unwrap_or_else(|| "—".into()),
            cmduse_core::money(model.month.cost),
            model.month.requests,
            cmduse_core::money(model.five_hour.cost),
            cmduse_core::money(model.weekly.cost),
        ),
        None => format!("{id}: no usage in the period\n"),
    }
}

/// Spend per bucket (day or hour), oldest first — `cmduse daily`/`hourly`.
fn bucket_text(rows: &[db::Row], now_ms: i64, days: i64, size_ms: i64, label: &str) -> String {
    let mut buckets: std::collections::BTreeMap<i64, (f64, u64, u64)> = Default::default();
    for row in rows {
        let bucket = row.at_ms.div_euclid(size_ms);
        let entry = buckets.entry(bucket).or_insert((0.0, 0, 0));
        entry.0 += row.cost_usd;
        entry.1 += 1;
        entry.2 += row.input + row.output + row.cache_read;
    }
    let start = (now_ms - days * 86_400_000).div_euclid(size_ms);
    let mut out = format!("{label:<12} spend     requests   tokens\n");
    for (bucket, (cost, requests, tokens)) in buckets.range(start..) {
        let stamp = if size_ms >= 86_400_000 {
            date_of(*bucket)
        } else {
            format!(
                "{} {:02}h",
                date_of(bucket.div_euclid(24)),
                bucket.rem_euclid(24)
            )
        };
        out.push_str(&format!(
            "{stamp:<12} {:>9} {:>12} {:>9}\n",
            cmduse_core::money(*cost),
            cmduse_core::compact(*requests),
            cmduse_core::compact(*tokens),
        ));
    }
    if out.lines().count() == 1 {
        out.push_str("(no OpenCode usage in the window)\n");
    }
    out
}

/// Spend per session, newest first.
fn session_text(rows: &[db::Row], limit: usize) -> String {
    let mut by_session: std::collections::BTreeMap<
        &str,
        (f64, u64, i64, std::collections::BTreeSet<&str>),
    > = Default::default();
    for row in rows {
        let entry =
            by_session
                .entry(row.session.as_str())
                .or_insert((0.0, 0, 0, Default::default()));
        entry.0 += row.cost_usd;
        entry.1 += 1;
        entry.2 = entry.2.max(row.at_ms);
        entry.3.insert(row.model.as_str());
    }
    let mut sessions: Vec<_> = by_session.into_iter().collect();
    sessions.sort_by_key(|(_, (_, _, last, _))| std::cmp::Reverse(*last));
    let mut out =
        String::from("session                          last        models   spend     req\n");
    for (id, (cost, requests, last, models)) in sessions.into_iter().take(limit) {
        let short = id.rsplit('_').next().unwrap_or(id);
        out.push_str(&format!(
            "{:<32} {:<11} {:>6} {:>9} {:>6}\n",
            short,
            date_of(last.div_euclid(86_400_000)),
            models.len(),
            cmduse_core::money(cost),
            requests,
        ));
    }
    if out.lines().count() == 1 {
        out.push_str("(no sessions in the window)\n");
    }
    out
}

/// `YYYY-MM-DD` for a Unix day number (civil-from-days, same helper family as
/// the window module's).
fn date_of(day: i64) -> String {
    let z = day + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}")
}
