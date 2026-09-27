// ocuse's presentation: a watch frame, a one-shot dashboard, a status line, and JSON.
//
// Reuses cmduse-core's pure formatters (money/compact/pct/duration) and cmduse's
// own palette, gauge and sparkline, so both tools read the same. Go's allowance
// is per model — not per account — so the header's window lines sum the caps of
// the models actually used this month and the table shows each model against its
// own limit; that distinction is the whole point of the Go plan.
use crate::ocuse::window::{ModelUsage, Report, Totals};
use crate::ocuse::zen;
use cmduse_core::{compact, duration, money, pct};

/// Gauge width for the window bars. cmduse makes this configurable; ocuse keeps
/// one width so the frame does not reflow between refreshes.
const BAR_WIDTH: usize = 20;

/// ANSI styles — cmduse's palette, or empty strings when colour is off, so a
/// piped run never leaks SGR escapes.
pub struct Ink {
    pub colour: bool,
    pub bold: &'static str,
    pub dim: &'static str,
    pub reset: &'static str,
    pub cyan: &'static str,
    pub green: &'static str,
    pub yellow: &'static str,
    pub red: &'static str,
}

impl Ink {
    pub fn new(colour: bool) -> Self {
        if colour {
            Self {
                colour,
                bold: crate::render::BOLD,
                dim: crate::render::DIM,
                reset: crate::render::RESET,
                cyan: crate::render::CYAN,
                green: crate::render::GREEN,
                yellow: crate::render::YELLOW,
                red: crate::render::RED,
            }
        } else {
            Self {
                colour,
                bold: "",
                dim: "",
                reset: "",
                cyan: "",
                green: "",
                yellow: "",
                red: "",
            }
        }
    }

    /// Colour a value without disturbing the caller's column padding: pad the
    /// text first, then wrap it.
    fn cyan_on(&self, text: String) -> String {
        format!("{}{text}{}", self.cyan, self.reset)
    }

    /// Severity for a used/limit percentage — cmduse's thresholds.
    fn for_pct(&self, pct_used: f64) -> &'static str {
        if !self.colour {
            ""
        } else if pct_used >= 90.0 {
            self.red
        } else if pct_used >= 70.0 {
            self.yellow
        } else {
            self.green
        }
    }

    /// Pct + gauge, exactly cmduse's `render::bar`; empty when colour is off so
    /// the plain frame keeps its script-friendly column layout.
    fn bar(&self, used: f64, cap: f64) -> String {
        if self.colour {
            crate::render::bar(used, cap, BAR_WIDTH)
        } else {
            String::new()
        }
    }
}

fn window_line(
    ink: &Ink,
    label: &str,
    used: &Totals,
    cap: Option<f64>,
    reset_ms: Option<i64>,
    now_ms: i64,
) -> String {
    let reset = reset_ms
        .map(|at| duration(((at - now_ms) / 1000).max(0) as u64))
        .unwrap_or_default();
    let reset_text = if reset.is_empty() {
        String::new()
    } else if ink.colour {
        format!(" · resets in {reset}")
    } else {
        format!(" · resets {reset}")
    };
    match cap {
        Some(cap) if cap > 0.0 => {
            if ink.colour {
                format!(
                    " {}{label:<8}{} {} {}{} / {}{}{}\n",
                    ink.bold,
                    ink.reset,
                    ink.bar(used.cost, cap),
                    ink.dim,
                    money(used.cost),
                    money(cap),
                    reset_text,
                    ink.reset,
                )
            } else {
                // The plain frame is the script-facing one: keep the old text.
                format!(
                    "  {label:<8} {} / {} ({}){reset_text}\n",
                    money(used.cost),
                    money(cap),
                    pct(used.cost, cap),
                )
            }
        }
        _ => format!("  {label:<8} {}{reset_text}\n", money(used.cost)),
    }
}

/// Sum of `limit * share` over the models used this month — an aggregate ceiling
/// across the models in play, since Go grants limits per model.
fn aggregate_cap(report: &Report, share: f64) -> Option<f64> {
    let total: f64 = report
        .models
        .iter()
        .filter(|m| m.month.cost > 0.0)
        .filter_map(|m| m.limit)
        .map(|limit| limit * share)
        .sum();
    (total > 0.0).then_some(total)
}

fn model_row(ink: &Ink, model: &ModelUsage) -> String {
    let limit = model.limit.map(money).unwrap_or_else(|| "—".into());
    let use_fraction = model.month_use();
    let use_text = use_fraction
        .map(|fraction| pct(fraction * 100.0, 100.0))
        .unwrap_or_else(|| "—".into());
    let use_tone = use_fraction.map(|f| ink.for_pct(f * 100.0)).unwrap_or("");
    // Pad before colouring: SGR escapes would otherwise count as columns.
    let spent = ink.cyan_on(format!("{:>10}", money(model.month.cost)));
    let use_cell = if use_tone.is_empty() {
        format!("{use_text:>7}")
    } else {
        format!("{use_tone}{use_text:>7}{}", ink.reset)
    };
    format!(
        "{:<28} {:>7} {spent} {use_cell} {:>8} {:>8} {:>7}\n",
        model.id,
        limit,
        money(model.five_hour.cost),
        money(model.weekly.cost),
        compact(model.month.requests),
    )
}

/// `limit` rows to show; `usize::MAX` for all.
pub fn render_text(report: &Report, db_path: &str, rows: usize, colour: bool) -> String {
    let ink = Ink::new(colour);
    let c = |text: String| ink.cyan_on(text);
    let shares = &zen::catalog().go.window_share;
    let mut out = String::new();
    out.push_str(&format!(
        "{}OpenCode usage{} — go + zen, from {}{}{}\n",
        ink.bold,
        ink.reset,
        ink.dim,
        shorten(db_path),
        ink.reset,
    ));
    out.push_str(&format!(
        "period: {} · {} requests · {} · {} tokens\n",
        report.period_label,
        c(compact(report.month.requests)),
        c(money(report.month.cost)),
        c(compact(report.month.tokens())),
    ));

    if report.month.requests > 0 {
        let five_reset = report.now_ms + crate::ocuse::window::FIVE_HOUR_SECS * 1000;
        let week_reset = report.now_ms + crate::ocuse::window::WEEKLY_SECS * 1000;
        out.push_str(&format!(
            "\n{}GO{} (limits are per model: 5h = 20%, weekly = 50%, monthly = 100%)\n",
            ink.bold, ink.reset
        ));
        out.push_str(&window_line(
            &ink,
            "5-hour",
            &report.five_hour,
            aggregate_cap(report, shares.five_hour),
            Some(five_reset),
            report.now_ms,
        ));
        out.push_str(&window_line(
            &ink,
            "weekly",
            &report.weekly,
            aggregate_cap(report, shares.weekly),
            Some(week_reset),
            report.now_ms,
        ));
        out.push_str(&window_line(
            &ink,
            "monthly",
            &report.month,
            aggregate_cap(report, shares.monthly),
            None,
            report.now_ms,
        ));
    }

    out.push_str(&format!(
        "\n{}MODEL                            LIMIT      SPENT     USE       5H       WK     REQ{}\n",
        ink.bold, ink.reset
    ));
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(&ink, model));
    }
    if report.models.len() > rows {
        out.push_str(&format!("… {} more\n", report.models.len() - rows));
    }
    out.push_str(
        "\nZEN is pay-as-you-go: the same rows carry its spend, but the docs give no limit.\n",
    );
    out
}

/// One watch frame: the dashboard, then a burst sparkline when the 5-hour spend
/// has moved since the previous refresh. No trailing newline — the caller
/// appends its own status line and `redraw_frame` (cmduse's) parks the cursor
/// there, which is what lets the countdown rewrite a single line per second.
pub fn watch_frame(
    report: &Report,
    db_path: &str,
    rows: usize,
    colour: bool,
    history: &[f64],
    interval_secs: u64,
) -> String {
    let ink = Ink::new(colour);
    let mut out = render_text(report, db_path, rows, colour);
    if history.len() >= 2 && history.iter().any(|v| *v > 0.0) {
        out.push_str(&format!(
            "{}spend bursts ({}s samples){} {}\n",
            ink.dim,
            interval_secs,
            ink.reset,
            crate::render::sparkline(history),
        ));
    }
    out.trim_end_matches('\n').to_string()
}

/// Compact single line for a status bar.
pub fn status_line(report: &Report) -> String {
    match report.models.first() {
        Some(top) => format!(
            "oc {} month · {} 5h · top {} {}",
            money(report.month.cost),
            money(report.five_hour.cost),
            top.id,
            money(top.month.cost)
        ),
        None => format!(
            "oc {} month · {} 5h",
            money(report.month.cost),
            money(report.five_hour.cost)
        ),
    }
}

/// Machine-readable projection: totals plus the per-model breakdown.
pub fn render_json(report: &Report) -> String {
    let totals = |t: &Totals| serde_json::json!({ "cost": t.cost, "requests": t.requests, "tokens": t.tokens() });
    let model = |m: &ModelUsage| {
        serde_json::json!({
            "id": m.id,
            "provider": m.provider,
            "limit": m.limit,
            "month": totals(&m.month),
            "fiveHour": totals(&m.five_hour),
            "weekly": totals(&m.weekly),
        })
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "source": "opencode.db",
        "generatedAt": report.now_ms,
        "periodStart": report.since_ms,
        "periodInferred": report.month_inferred,
        "totals": {
            "month": totals(&report.month),
            "fiveHour": totals(&report.five_hour),
            "weekly": totals(&report.weekly),
        },
        "models": report.models.iter().map(model).collect::<Vec<_>>(),
    }))
    .expect("json")
}

fn shorten(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() => path.replacen(&home, "~", 1),
        _ => path.to_string(),
    }
}

// ---- catalogues and history tables (shared with the MCP server) -------------

/// The catalogue: what each product costs and (for Go) what it allows.
pub fn plans_text() -> String {
    let catalog = crate::ocuse::zen::catalog();
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

pub fn model_text(report: &Report, id: &str) -> String {
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
pub fn bucket_text(
    rows: &[crate::ocuse::db::Row],
    now_ms: i64,
    days: i64,
    size_ms: i64,
    label: &str,
    tz_secs: i64,
) -> String {
    // Buckets are cut in the display timezone: shift, bucket, then label.
    let shift = tz_secs * 1000;
    let mut buckets: std::collections::BTreeMap<i64, (f64, u64, u64)> = Default::default();
    for row in rows {
        let bucket = (row.at_ms + shift).div_euclid(size_ms);
        let entry = buckets.entry(bucket).or_insert((0.0, 0, 0));
        entry.0 += row.cost_usd;
        entry.1 += 1;
        entry.2 += row.input + row.output + row.cache_read;
    }
    let start = (now_ms + shift - days * 86_400_000).div_euclid(size_ms);
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
pub fn session_text(rows: &[crate::ocuse::db::Row], limit: usize) -> String {
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
pub fn date_of(day: i64) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ocuse::db::Row;

    fn report() -> Report {
        let now = 1_800_000_000_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 30.0,
            ..Default::default()
        }];
        crate::ocuse::window::build(&rows, &zen::catalog(), now, None)
    }

    #[test]
    fn text_shows_the_model_against_its_limit() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false);
        assert!(text.contains("glm-5.3-flash"), "{text}");
        assert!(text.contains("$60"), "the model's monthly limit: {text}");
        assert!(text.contains("50%"), "30 of 60 is half: {text}");
    }

    #[test]
    fn json_and_status_line_carry_the_totals() {
        let json = render_json(&report());
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["totals"]["month"]["cost"], 30.0);
        assert_eq!(parsed["models"][0]["id"], "glm-5.3-flash");
        assert!(status_line(&report()).contains("glm-5.3-flash"));
    }

    #[test]
    fn plain_frames_carry_no_escapes() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false);
        assert!(
            !text.contains('\x1b'),
            "piped output must stay plain: {text}"
        );
        // The gauge is colour-only; the plain frame keeps the old percentage text.
        assert!(text.contains("50%"), "{text}");
    }

    #[test]
    fn colour_frames_get_the_palette_and_a_gauge() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, true);
        assert!(text.contains(crate::render::BOLD), "{text}");
        assert!(text.contains(crate::render::CYAN), "{text}");
        assert!(
            text.contains(crate::render::GREEN),
            "the 50% monthly gauge and USE cell are green: {text}"
        );
        assert!(
            text.contains(crate::render::RED),
            "the over-cap 5-hour gauge (30 of 12) is red: {text}"
        );
        assert!(
            text.contains('━') && text.contains('╱'),
            "gauge bar: {text}"
        );
        assert!(text.contains("resets in"), "{text}");
    }

    #[test]
    fn watch_frame_ends_on_the_status_line_and_shows_bursts() {
        let frame = watch_frame(
            &report(),
            "/tmp/opencode.db",
            10,
            true,
            &[0.0, 1.5, 0.0],
            10,
        );
        assert!(
            !frame.ends_with('\n'),
            "the caller's status line owns the last row"
        );
        assert!(frame.contains("spend bursts (10s samples)"), "{frame}");
        assert!(
            frame.contains('█'),
            "a nonzero delta shows as a tall bar: {frame}"
        );
    }

    #[test]
    fn idle_history_omits_the_sparkline() {
        let all_idle = watch_frame(&report(), "/tmp/opencode.db", 10, true, &[0.0, 0.0], 10);
        assert!(!all_idle.contains("spend bursts"), "{all_idle}");
        let first_frame = watch_frame(&report(), "/tmp/opencode.db", 10, true, &[], 10);
        assert!(!first_frame.contains("spend bursts"), "{first_frame}");
    }
}
