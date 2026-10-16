// ocuse's presentation: a watch frame, a one-shot dashboard, a status line, and JSON.
//
// Reuses cmduse-core's pure formatters (money/compact/pct/duration) and cmduse's
// own palette, gauge and sparkline, so both tools read the same. Go's allowance
// is per model — not per account — so the header's window lines sum the caps of
// the models actually used this month and the table shows each model against its
// own limit; that distinction is the whole point of the Go plan.
use crate::ocuse::window::{ModelUsage, Report, Totals};
use crate::ocuse::zen;
use crate::report_render::Fmt;
use cmduse_core::{compact, duration, money, pct};

/// Gauge width for the window bars when neither config nor `--bar-width` says
/// otherwise — cmduse's own default.
pub const DEFAULT_BAR_WIDTH: usize = 20;

/// ANSI styles — cmduse's palette, or empty strings when colour is off, so a
/// piped run never leaks SGR escapes.
pub struct Ink {
    pub colour: bool,
    /// Gauge width for the window bars (config / `--bar-width`).
    pub bar_width: usize,
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
                bar_width: DEFAULT_BAR_WIDTH,
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
                bar_width: DEFAULT_BAR_WIDTH,
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

    /// Override the gauge width (config / `--bar-width`); chains after `new`.
    pub fn width(mut self, width: usize) -> Self {
        self.bar_width = width;
        self
    }

    /// Colour a value without disturbing the caller's column padding: pad the
    /// text first, then wrap it.
    fn cyan_on(&self, text: String) -> String {
        format!("{}{text}{}", self.cyan, self.reset)
    }

    /// Secondary information — cmduse's `DIM`.
    fn dim_on(&self, text: String) -> String {
        format!("{}{text}{}", self.dim, self.reset)
    }

    fn bold_on(&self, text: String) -> String {
        format!("{}{text}{}", self.bold, self.reset)
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
            crate::render::bar(used, cap, self.bar_width)
        } else {
            String::new()
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn window_line(
    ink: &Ink,
    label: &str,
    used: &Totals,
    cap: Option<f64>,
    reset_ms: Option<i64>,
    // Length of the window ending at `reset_ms`; `None` when there is no real
    // reset to measure against (the rolling 5h/weekly windows are cut at
    // `now - window` locally, so they have no boundary — see `render_text`).
    dur_secs: Option<u64>,
    // `cmduse`'s pro-rata flag: monthly is a budget, so it alone gets the
    // "by now" figure; the rolling windows are throttles, where that number
    // would read as a spend target.
    pro_rata: bool,
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
    // cmduse's field order is importance order, so a clipped watch frame keeps
    // the actionable parts: limit flag, pace warning, elapsed share, then the
    // informational pro-rata figure. Percentages come from core (one decimal);
    // duration (never rel_time) formats the ETA.
    let now_secs = (now_ms / 1000).max(0) as u64;
    let reset_at = reset_ms.map(|ms| ms as f64);
    let elapsed = dur_secs.and_then(|d| cmduse_core::elapsed_pct(reset_at, d, Some(now_secs)));
    let pace = dur_secs
        .and_then(|d| {
            cmduse_core::pace_eta(reset_at, d, used.cost, cap.unwrap_or(0.0), now_secs)
                .map(|secs| duration(secs as u64))
        })
        .map(|eta| format!(" · {}on pace to hit cap in {eta}{}", ink.yellow, ink.reset))
        .unwrap_or_default();
    let thru = elapsed
        .map(|p| format!(" · {}window {p:.1}% elapsed{}", ink.dim, ink.reset))
        .unwrap_or_default();
    let by_now = match (pro_rata, elapsed) {
        (true, Some(p)) => format!(
            " · {}{} by now{}",
            ink.dim,
            money(cap.unwrap_or(0.0) * p / 100.0),
            ink.reset
        ),
        _ => String::new(),
    };
    match cap {
        Some(cap) if cap > 0.0 => {
            // Same placement cmduse uses for the flag: on the window it belongs to.
            let flag = if used.cost > cap {
                format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
            } else {
                String::new()
            };
            if ink.colour {
                format!(
                    " {}{label:<8}{} {} {}{} / {}{}{}{}{}{}{}\n",
                    ink.bold,
                    ink.reset,
                    ink.bar(used.cost, cap),
                    ink.dim,
                    money(used.cost),
                    money(cap),
                    reset_text,
                    flag,
                    pace,
                    thru,
                    by_now,
                    ink.reset,
                )
            } else {
                // The plain frame is the script-facing one: same field order,
                // no SGR (the Ink helpers are empty strings when colour is off).
                format!(
                    "  {label:<8} {} / {} ({}){reset_text}{flag}{pace}{thru}{by_now}\n",
                    money(used.cost),
                    money(cap),
                    pct(used.cost, cap),
                )
            }
        }
        // No cap to measure against (free models, Zen-only rows): secondary, so
        // dim it the way cmduse dims its pay-as-you-go line.
        _ => format!(
            "  {label:<8} {}\n",
            ink.dim_on(format!("{}{}", money(used.cost), reset_text))
        ),
    }
}

/// One of the account's own meters, as `opencode.ai/console` shows it: the
/// server's percentage, its reset instant, and its verdict. No dollar figure
/// belongs here — the endpoint publishes shares and instants, not money; that is
/// what the model table is for.
fn meter_line(ink: &Ink, label: &str, meter: &crate::ocuse::api::Meter, now_ms: i64) -> String {
    let reset = meter
        .reset_ms()
        .map(|at| duration(((at - now_ms) / 1000).max(0) as u64))
        .unwrap_or_default();
    let reset_text = if reset.is_empty() {
        String::new()
    } else {
        format!(" · resets in {reset}")
    };
    // Actionable before informational, as everywhere else: a server verdict
    // outranks the reset countdown.
    let flag = if meter.exceeded() {
        format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
    } else if !meter.status.eq_ignore_ascii_case("ok") {
        format!(" {}{}{}{}", ink.red, meter.status, ink.reset, "")
    } else {
        String::new()
    };
    let share = pct(meter.percent, 100.0);
    if ink.colour {
        let tone = ink.for_pct(meter.percent);
        format!(
            " {}{label:<8}{} {} {tone}{share:>7}{}{reset_text}{flag}\n",
            ink.bold,
            ink.reset,
            ink.bar(meter.percent, 100.0),
            ink.reset,
        )
    } else {
        format!("  {label:<8} {share:>7}{reset_text}{flag}\n")
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

/// Is any of this model's windows over its share of the limit? Go meters per
/// model *and* per window, so being over the 5-hour cap counts like being over
/// the month. One verdict, shared with the watch loop's cap notification.
fn exceeded(model: &ModelUsage) -> bool {
    crate::ocuse::window::over_window(model).is_some()
}

fn model_row(ink: &Ink, model: &ModelUsage, total_cost: f64) -> String {
    let limit = match model.limit {
        Some(limit) => money(limit),
        None => ink.dim_on("—".into()),
    };
    let use_fraction = model.month_use();
    let use_text = use_fraction
        .map(|fraction| pct(fraction * 100.0, 100.0))
        .unwrap_or_else(|| "—".into());
    // Pad before colouring: SGR escapes would otherwise count as columns.
    let spent = ink.cyan_on(format!("{:>10}", money(model.month.cost)));
    let use_cell = match use_fraction {
        Some(fraction) => {
            let tone = ink.for_pct(fraction * 100.0);
            if tone.is_empty() {
                format!("{use_text:>7}")
            } else {
                format!("{tone}{use_text:>7}{}", ink.reset)
            }
        }
        None => ink.dim_on(format!("{use_text:>7}")),
    };
    // Actionable before informational (cmduse's ordering): the flag sits beside
    // the model so a clipped frame keeps it; the share is the first thing to go.
    let flag = if exceeded(model) {
        format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
    } else {
        String::new()
    };
    let share = if total_cost > 0.0 {
        ink.dim_on(format!(" {:>5.1}%", model.month.cost / total_cost * 100.0))
    } else {
        String::new()
    };
    format!(
        "{:<28}{flag} {:>7} {spent} {use_cell} {} {} {:>7}{share}\n",
        model.id,
        limit,
        // Go windows are per model too: 5h = 20% of the limit, weekly = 50%.
        window_cell(ink, model, model.five_hour.cost, 0.20),
        window_cell(ink, model, model.weekly.cost, 0.50),
        compact(model.month.requests),
    )
}

/// One rolling-window column, coloured against that model's own share of the
/// limit; models with no limit (free, or Zen-only) are dimmed instead.
fn window_cell(ink: &Ink, model: &ModelUsage, cost: f64, share: f64) -> String {
    let text = format!("{:>8}", money(cost));
    match model.limit.filter(|limit| *limit > 0.0) {
        Some(limit) => {
            let tone = ink.for_pct(cost / (limit * share) * 100.0);
            if tone.is_empty() {
                text
            } else {
                format!("{tone}{text}{}", ink.reset)
            }
        }
        None => ink.dim_on(text),
    }
}

/// `limit` rows to show; `usize::MAX` for all.
pub fn render_text(
    report: &Report,
    db_path: &str,
    rows: usize,
    colour: bool,
    bar_width: usize,
) -> String {
    let ink = Ink::new(colour).width(bar_width);
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
    // cmduse prints `Success N%` from its account API; opencode's own store
    // records no per-request success/error signal, so there is no rate to read
    // here — omitted rather than synthesised (source-forced).
    let end = report
        .period_end_ms
        .map(|ms| format!(" · ends {}", date_of(ms / 86_400_000)))
        .unwrap_or_default();
    out.push_str(&format!(
        "period: {}{end} · {} requests · {} · {} in / {} out tokens\n",
        report.period_label,
        c(compact(report.month.requests)),
        c(money(report.month.cost)),
        c(compact(report.month.input)),
        c(compact(report.month.output)),
    ));

    // The three window rows. When the account answered, they are its own meters
    // — the only view that agrees with opencode.ai/console, and the reason this
    // endpoint is read at all: the store cannot reproduce the server's window
    // anchors or its price basis (see `ocuse::api`).
    match &report.account {
        Some(account) => {
            out.push_str(&format!(
                "\n{}GO{} {}\n",
                ink.bold,
                ink.reset,
                ink.dim_on("(account meters — what opencode.ai/console reports)".into()),
            ));
            out.push_str(&meter_line(&ink, "5-hour", &account.rolling, report.now_ms));
            out.push_str(&meter_line(&ink, "Weekly", &account.weekly, report.now_ms));
            out.push_str(&meter_line(
                &ink,
                "Monthly",
                &account.monthly,
                report.now_ms,
            ));
        }
        // No Go key, no network, or a key without the subscription: the store's
        // own estimate, which says so. Its windows are the local ones (`now -
        // 5h` / `now - 7d` / the period), so they can disagree with the account.
        None if report.month.requests > 0 => {
            let five_reset = report.now_ms + crate::ocuse::window::FIVE_HOUR_SECS * 1000;
            let week_reset = report.now_ms + crate::ocuse::window::WEEKLY_SECS * 1000;
            // Only the monthly period has a real end (`period_end_ms`): the
            // local rolling windows are cut at `now - window`, so they keep
            // their countdown but gain no elapsed share or pace ETA.
            let monthly_dur = report
                .period_end_ms
                .map(|end| ((end - report.since_ms) / 1000).max(0) as u64);
            out.push_str(&format!(
                "\n{}GO{} {}\n",
                ink.bold,
                ink.reset,
                ink.dim_on(
                    "(estimated locally — limits are per model: 5h = 20%, weekly = 50%, monthly = 100%)"
                        .into()
                ),
            ));
            out.push_str(&window_line(
                &ink,
                "5-hour",
                &report.five_hour,
                aggregate_cap(report, shares.five_hour),
                Some(five_reset),
                None,
                false,
                report.now_ms,
            ));
            out.push_str(&window_line(
                &ink,
                "Weekly",
                &report.weekly,
                aggregate_cap(report, shares.weekly),
                Some(week_reset),
                None,
                false,
                report.now_ms,
            ));
            out.push_str(&window_line(
                &ink,
                "Monthly",
                &report.month,
                aggregate_cap(report, shares.monthly),
                report.period_end_ms,
                monthly_dur,
                true,
                report.now_ms,
            ));
        }
        None => {}
    }

    out.push_str(&format!(
        "\n{}MODEL                            LIMIT      SPENT     USE       5H       WK     REQ{}\n",
        ink.bold, ink.reset
    ));
    let total_cost = report.month.cost;
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(&ink, model, total_cost));
    }
    if report.models.len() > rows {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(format!("… {} more", report.models.len() - rows))
        ));
    }
    out.push_str(&format!(
        "\n{}\n",
        ink.dim_on(
            "ZEN is pay-as-you-go: the same rows carry its spend, but the docs give no limit."
                .into()
        )
    ));
    // The GO block above is the account's own metering. These two columns are
    // per model and cut from this machine's store, so say so rather than let
    // them read as a second opinion on the same window.
    if report.account.is_some() {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(
                "5H/WK columns: this model's own spend over the last 5h / 7 days (local, not the account's windows)."
                    .into()
            )
        ));
    }
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
    bar_width: usize,
) -> String {
    let ink = Ink::new(colour);
    let mut out = render_text(report, db_path, rows, colour, bar_width);
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

/// Minimal one-line dashboard for terminals too small for the full frame:
/// period spend, rolling windows, and the burst sparkline inlined when active.
/// No trailing newline — the caller appends its own status line, exactly like
/// `watch_frame`.
pub fn compact_line(report: &Report, history: &[f64], colour: bool) -> String {
    let ink = Ink::new(colour);
    let spark = if history.len() >= 2 && history.iter().any(|v| *v > 0.0) {
        format!(
            " {}{}{}",
            ink.dim,
            crate::render::sparkline(history),
            ink.reset
        )
    } else {
        String::new()
    };
    // The 5-hour figure is the one a narrow terminal shows, and the store's
    // rolling 5h is not the server's block: prefer the account's own share
    // whenever the endpoint answered (see `ocuse::api`). The month spend stays
    // money — it is a budget, not a throttle.
    let window_share = match &report.account {
        Some(account) => format!(
            " · 5h {} · wk {}",
            ink.cyan_on(pct(account.rolling.percent, 100.0)),
            ink.cyan_on(pct(account.weekly.percent, 100.0)),
        ),
        None => format!(" · 5h {}", ink.cyan_on(money(report.five_hour.cost))),
    };
    format!(
        "{}oc{} {} month{window_share}{spark}",
        ink.bold,
        ink.reset,
        ink.cyan_on(money(report.month.cost)),
    )
}

/// ocuse's statusline: cmduse's `{key}` template engine (`report_render::
/// render_template`) resolved against this report's own placeholders, so both
/// binaries are driven by `statusline_template` in their config.
///
/// Placeholders (case-insensitive):
///   {plan} {period}                plan id / period label
///   {month} {month_pct} {month_bar}
///   {five_hour} {five_hour_pct} {five_hour_bar}   (aliases {5h} {5h_pct} {5h_bar})
///   {weekly} {weekly_pct} {weekly_bar}            (aliases {wk} {wk_pct} {wk_bar})
///   {models}                       top model by period spend
///   | or newline                    literal separators
/// Unknown placeholders are dropped. Percentages are one decimal; money reuses
/// `cmduse_core::money`; bars reuse `report_render::bar` (ascii/colour aware).
pub fn statusline_template(
    report: &Report,
    plan_id: &str,
    tpl: &str,
    colours: bool,
    ascii: bool,
    bar_width: usize,
) -> String {
    let ink = Ink::new(colours);
    let shares = &zen::catalog().go.window_share;
    let month_cap = aggregate_cap(report, shares.monthly);
    let five_cap = aggregate_cap(report, shares.five_hour);
    let week_cap = aggregate_cap(report, shares.weekly);
    let cash = |v: f64| ink.cyan_on(money(v));
    let pct_of = |used: f64, cap: Option<f64>| match cap {
        Some(cap) => pct(used, cap),
        None => "—".into(),
    };
    let bar_of = |used: f64, cap: Option<f64>| match cap.filter(|c| *c > 0.0) {
        Some(cap) => crate::report_render::bar(used / cap * 100.0, bar_width, ascii, colours),
        None => String::new(),
    };
    // The account's own share outranks the local one wherever both exist: it is
    // what opencode.ai/console shows, and the local estimate's window anchors are
    // not the server's (see `ocuse::api`). Money tokens stay local either way —
    // the endpoint publishes shares and instants, not dollars.
    let account = report.account.as_ref();
    let share_of =
        |meter: Option<&crate::ocuse::api::Meter>, used: f64, cap: Option<f64>| match meter {
            Some(meter) => pct(meter.percent, 100.0),
            None => pct_of(used, cap),
        };
    let share_bar =
        |meter: Option<&crate::ocuse::api::Meter>, used: f64, cap: Option<f64>| match meter {
            Some(meter) => crate::report_render::bar(meter.percent, bar_width, ascii, colours),
            None => bar_of(used, cap),
        };
    let top_model = || {
        report
            .models
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_else(|| "—".into())
    };
    crate::report_render::render_template(tpl, |key| match key {
        "plan" => plan_id.to_string(),
        "period" => report.period_label.clone(),
        "month" => cash(report.month.cost),
        "month_pct" => share_of(account.map(|a| &a.monthly), report.month.cost, month_cap),
        "month_bar" => share_bar(account.map(|a| &a.monthly), report.month.cost, month_cap),
        "five_hour" | "5h" => cash(report.five_hour.cost),
        "five_hour_pct" | "5h_pct" => {
            share_of(account.map(|a| &a.rolling), report.five_hour.cost, five_cap)
        }
        "five_hour_bar" | "5h_bar" => {
            share_bar(account.map(|a| &a.rolling), report.five_hour.cost, five_cap)
        }
        "weekly" | "wk" => cash(report.weekly.cost),
        "weekly_pct" | "wk_pct" => {
            share_of(account.map(|a| &a.weekly), report.weekly.cost, week_cap)
        }
        "weekly_bar" | "wk_bar" => {
            share_bar(account.map(|a| &a.weekly), report.weekly.cost, week_cap)
        }
        "models" => top_model(),
        _ => String::new(),
    })
}

/// `ocuse statusline --json`: the same numbers the template resolves, in one
/// object — plan and period label, period/month spend, the two rolling windows,
/// and the top model. Caps are the aggregate ceilings `aggregate_cap` uses for
/// the template's `{…_pct}`/`{…_bar}` placeholders (null when nothing is capped).
pub fn statusline_json(report: &Report, plan_id: &str) -> String {
    let shares = &zen::catalog().go.window_share;
    serde_json::json!({
        "plan": plan_id,
        "period": report.period_label,
        "monthSpent": report.month.cost,
        "monthCap": aggregate_cap(report, shares.monthly),
        "fiveHourSpent": report.five_hour.cost,
        "fiveHourCap": aggregate_cap(report, shares.five_hour),
        "weeklySpent": report.weekly.cost,
        "weeklyCap": aggregate_cap(report, shares.weekly),
        "model": report.models.first().map(|m| m.id.clone()),
    })
    .to_string()
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
    // The account's own meters, when the Go usage endpoint answered. Consumers
    // (the sidebar's Go block among them) should prefer these over the local
    // `totals`, which cannot reproduce the server's anchors or price basis.
    let meter = |m: &crate::ocuse::api::Meter| {
        serde_json::json!({
            "status": m.status,
            "percent": m.percent,
            "resetsAt": m.reset_ms(),
        })
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "source": "opencode.db",
        "generatedAt": report.now_ms,
        "periodStart": report.since_ms,
        // Period bounds in epoch ms, the same units as cmduse's `-1 --json`
        // (`periodStartAt`/`periodEndAt`) — `periodStart` stays for the plugin's
        // existing read. `periodEndAt` is null when the period has no boundary
        // (`--window all`).
        "periodStartAt": report.since_ms,
        "periodEndAt": report.period_end_ms,
        "periodInferred": report.month_inferred,
        "totals": {
            "month": totals(&report.month),
            "fiveHour": totals(&report.five_hour),
            "weekly": totals(&report.weekly),
        },
        // `null` when no Go key, no network, or a key without the subscription:
        // the caller then has only `totals`, which is the local estimate.
        "account": report.account.as_ref().map(|a| serde_json::json!({
            "rolling": meter(&a.rolling),
            "weekly": meter(&a.weekly),
            "monthly": meter(&a.monthly),
        })),
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

/// The catalogue: what each product costs and (for Go) what each plan allows.
///
/// Both Go plans are listed because the docs define two — Go and Go Plus — that
/// share one token price list but grant each model a different monthly limit.
pub fn plans_text(colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = crate::ocuse::zen::catalog();
    let mut out = format!(
        "{}OpenCode plans{} {}\n",
        ink.bold,
        ink.reset,
        ink.dim_on(format!("(docs, extracted {})", catalog.extracted_at)),
    );
    out.push_str(&format!(
        "{}windows (both plans): 5h {} · weekly {} · monthly {}{}\n",
        ink.dim,
        ink.cyan_on(format!("{:.1}%", catalog.go.window_share.five_hour * 100.0)),
        ink.cyan_on(format!("{:.1}%", catalog.go.window_share.weekly * 100.0)),
        ink.cyan_on(format!("{:.1}%", catalog.go.window_share.monthly * 100.0)),
        ink.reset,
    ));
    for plan in catalog.go.plans.values() {
        out.push_str(&format!(
            "\n{}{}{} — {}/month\n",
            ink.bold,
            plan.label,
            ink.reset,
            ink.cyan_on(format!("${:.2}", plan.price_usd)),
        ));
        out.push_str(&format!(
            "{}MODEL                            LIMIT    IN     OUT    CACHE{}\n",
            ink.bold, ink.reset
        ));
        for model in &catalog.go.models {
            let rate = model.variants.first();
            let limit = plan
                .allowance_by_model
                .get(&model.id)
                .map(|limit| cmduse_core::money(*limit))
                .unwrap_or_else(|| "—".into());
            out.push_str(&format!(
                "{:<28} {} {} {} {}\n",
                model.id,
                ink.cyan_on(format!("{limit:>7}")),
                ink.cyan_on(format!(
                    "{:>6}",
                    rate.map(|r| format!("${}", r.input)).unwrap_or_default()
                )),
                ink.cyan_on(format!(
                    "{:>6}",
                    rate.map(|r| format!("${}", r.output)).unwrap_or_default()
                )),
                ink.cyan_on(format!(
                    "{:>8}",
                    rate.map(|r| format!("${}", r.cache_read))
                        .unwrap_or_default()
                )),
            ));
        }
    }
    out.push_str(&format!(
        "\n{}\n",
        ink.dim_on(format!(
            "ZEN — pay-as-you-go, {} models priced per 1M tokens",
            catalog.zen.models.len()
        ))
    ));
    out
}

/// The Go/Zen catalogue as one JSON object — the machine twin of `plans_text`:
/// both plans (label, price, per-model monthly allowances), the shared window
/// shares, and the Go and Zen rate tables.
pub fn plans_json() -> String {
    let catalog = crate::ocuse::zen::catalog();
    let plans: Vec<serde_json::Value> = catalog
        .go
        .plans
        .iter()
        .map(|(id, plan)| {
            serde_json::json!({
                "id": id,
                "label": plan.label,
                "priceUsd": plan.price_usd,
                "allowanceByModel": &plan.allowance_by_model,
            })
        })
        .collect();
    serde_json::json!({
        "extractedAt": catalog.extracted_at,
        "windows": {
            "fiveHour": catalog.go.window_share.five_hour,
            "weekly": catalog.go.window_share.weekly,
            "monthly": catalog.go.window_share.monthly,
        },
        "plans": plans,
        "models": catalog.go.models.iter().map(rate_json).collect::<Vec<_>>(),
        "zen": catalog.zen.models.iter().map(rate_json).collect::<Vec<_>>(),
    })
    .to_string()
}

/// One catalogue row's shared `$`/1M rates, taken from its base (first) variant.
fn rate_json(model: &zen::Model) -> serde_json::Value {
    let rate = model.variants.first();
    serde_json::json!({
        "id": model.id,
        "name": model.name,
        "input": rate.map(|r| r.input),
        "output": rate.map(|r| r.output),
        "cacheRead": rate.map(|r| r.cache_read),
        "cacheWrite": rate.map(|r| r.cache_write),
    })
}

/// One `ocuse models` row: a catalogued Go model, its rates, and the selected
/// plan's monthly limit (`None` = the plan does not grant it).
struct ModelRow {
    id: String,
    name: String,
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    limit: Option<f64>,
}

/// The Go catalogue joined with the plan's allowances; `gated` keeps only the
/// models the plan grants (present in `allowanceByModel`).
fn model_rows(plan_id: &str, gated: bool) -> Vec<ModelRow> {
    let catalog = crate::ocuse::zen::catalog();
    let plan = catalog.plan(plan_id);
    let mut rows: Vec<ModelRow> = catalog
        .go
        .models
        .iter()
        .map(|m| {
            let rate = m.variants.first();
            ModelRow {
                id: m.id.clone(),
                name: m.name.clone(),
                input: rate.map(|r| r.input),
                output: rate.map(|r| r.output),
                cache_read: rate.map(|r| r.cache_read),
                limit: plan.and_then(|p| p.allowance_by_model.get(&m.id).copied()),
            }
        })
        .collect();
    if gated {
        rows.retain(|r| r.limit.is_some());
    }
    rows
}

/// `ocuse models`: the Go catalogue for one plan — name, id, `$`/1M in / out /
/// cache-read, and that plan's monthly limit. Without `gated`, every catalogued
/// model is listed and the `GRANTED` column marks which the plan allows.
pub fn models_text(plan_id: &str, gated: bool, colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = crate::ocuse::zen::catalog();
    let label = catalog
        .plan(plan_id)
        .map(|p| p.label.clone())
        .unwrap_or_else(|| plan_id.to_string());
    let granted = catalog
        .plan(plan_id)
        .map(|p| p.allowance_by_model.len())
        .unwrap_or(0);
    let rows = model_rows(plan_id, gated);
    let mut out = format!(
        "{}{label} models{} {}\n",
        ink.bold,
        ink.reset,
        ink.dim_on(format!(
            "(plan {plan_id} · {granted}/{} granted)",
            catalog.go.models.len()
        )),
    );
    out.push_str(&format!(
        "{}{:<30} {:<28} {:>7} {:>7} {:>7} {:>8} {:>7}{}\n",
        ink.bold, "MODEL", "ID", "IN", "OUT", "CACHE", "LIMIT", "GRANTED", ink.reset
    ));
    let rate_cell = |v: Option<f64>| match v {
        Some(v) => ink.cyan_on(format!("{:>7}", format!("${v}"))),
        None => ink.dim_on(format!("{:>7}", "—")),
    };
    for r in &rows {
        let limit = match r.limit {
            Some(l) => ink.cyan_on(format!("{:>8}", cmduse_core::money(l))),
            None => ink.dim_on(format!("{:>8}", "—")),
        };
        let granted = if r.limit.is_some() { "yes" } else { "no" };
        out.push_str(&format!(
            "{:<30} {:<28} {} {} {} {} {:>7}\n",
            r.name,
            r.id,
            rate_cell(r.input),
            rate_cell(r.output),
            rate_cell(r.cache_read),
            limit,
            granted,
        ));
    }
    out
}

/// `ocuse models --json`: one JSON object per line (matching cmduse's
/// `models --json`), each model's id, name, `$`/1M rates, plan limit (null
/// when not granted) and the `granted` verdict.
pub fn models_json(plan_id: &str, gated: bool) -> String {
    let mut out = String::new();
    for r in model_rows(plan_id, gated) {
        out.push_str(
            &serde_json::json!({
                "id": r.id,
                "name": r.name,
                "input": r.input,
                "output": r.output,
                "cacheRead": r.cache_read,
                "limit": r.limit,
                "granted": r.limit.is_some(),
            })
            .to_string(),
        );
        out.push('\n');
    }
    out
}

pub fn model_text(report: &Report, id: &str, colour: bool) -> String {
    let ink = Ink::new(colour);
    let Some(model) = report.models.iter().find(|m| m.id == id) else {
        return format!("{id}: no usage in the period\n");
    };
    let limit = model
        .limit
        .map(cmduse_core::money)
        .unwrap_or_else(|| "—".into());
    let row =
        |label: &str, value: String| format!("  {}{value}\n", ink.dim_on(format!("{label:<10}")));
    let mut out = format!(
        "{} {}\n",
        ink.bold_on(model.id.clone()),
        ink.dim_on(format!("({})", model.provider)),
    );
    out.push_str(&row("limit", ink.cyan_on(limit)));
    out.push_str(&row(
        "month",
        ink.cyan_on(format!(
            "{} · {} requests",
            cmduse_core::money(model.month.cost),
            model.month.requests
        )),
    ));
    out.push_str(&row(
        "5-hour",
        ink.cyan_on(cmduse_core::money(model.five_hour.cost)),
    ));
    out.push_str(&row(
        "weekly",
        ink.cyan_on(cmduse_core::money(model.weekly.cost)),
    ));
    // The dashboard's share column needs the period total; here it is the same
    // fact spelled out. Absent when the period has no spend to divide by.
    if report.month.cost > 0.0 {
        out.push_str(&row(
            "share",
            ink.dim_on(format!(
                "{:.1}% of period spend",
                model.month.cost / report.month.cost * 100.0
            )),
        ));
    }
    out
}

/// Per-key JSON totals — the same field vocabulary cmduse's
/// `report_render::totals_json` uses. `cacheWrite` is deliberately absent:
/// ocuse's `window::Totals` carries no cache-write (the store's rows do, but
/// nothing aggregates them into a report), so no column is invented for it.
fn totals_json(
    cost: f64,
    requests: u64,
    input: u64,
    output: u64,
    cache_read: u64,
) -> serde_json::Value {
    serde_json::json!({
        "requests": requests,
        "tokensIn": input,
        "tokensOut": output,
        "cacheRead": cache_read,
        "costUsd": cost,
    })
}

/// One day/hour bucket's totals, kept apart per column so the CSV/JSON forms do
/// not have to re-derive them from a packed tuple.
#[derive(Default, Clone, Copy)]
struct Bucket {
    cost: f64,
    requests: u64,
    input: u64,
    output: u64,
    cache_read: u64,
}

impl Bucket {
    fn add(&mut self, row: &crate::ocuse::db::Row) {
        self.cost += row.cost_usd;
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
        self.cache_read += row.cache_read;
    }

    fn json(&self) -> serde_json::Value {
        totals_json(
            self.cost,
            self.requests,
            self.input,
            self.output,
            self.cache_read,
        )
    }
}

/// Per-model report — `ocuse model` on the whole period (or one id). The
/// machine formats project the report's models: `Json` mirrors cmduse's
/// `model --json` envelope (`{source, sinceMs, models:{id: totals}}`, with the
/// Go limit added), `Csv` is one row per model
/// (`model,requests,tokens_in,tokens_out,cache_read,cost_usd`). The `Table` form
/// is the caller's — the dashboard (no id) or the single-model detail (with an
/// id) — which needs the db path and row cap, so it is rendered there.
pub fn model_report(report: &Report, id: Option<&str>, fmt: Fmt) -> String {
    let models: Vec<&ModelUsage> = report
        .models
        .iter()
        .filter(|m| id.is_none_or(|want| m.id == want))
        .collect();
    match fmt {
        Fmt::Json => {
            let map: serde_json::Map<String, serde_json::Value> = models
                .iter()
                .map(|m| {
                    let mut body = totals_json(
                        m.month.cost,
                        m.month.requests,
                        m.month.input,
                        m.month.output,
                        m.month.cache_read,
                    );
                    body["limit"] = serde_json::json!(m.limit);
                    (m.id.clone(), body)
                })
                .collect();
            serde_json::json!({
                "scope": "local",
                "source": "opencode",
                "sinceMs": report.since_ms,
                "models": map,
            })
            .to_string()
        }
        Fmt::Csv => {
            let mut out = String::from("model,requests,tokens_in,tokens_out,cache_read,cost_usd\n");
            for m in models {
                out.push_str(&format!(
                    "{},{},{},{},{},{:.2}\n",
                    crate::report_render::csv_field(&m.id),
                    m.month.requests,
                    m.month.input,
                    m.month.output,
                    m.month.cache_read,
                    m.month.cost,
                ));
            }
            out
        }
        Fmt::Table => String::new(), // the caller renders the table form
    }
}

/// Spend per bucket (day or hour), oldest first — `cmduse daily`/`hourly`.
/// `lookback_ms` is the read window and `size_ms` the bucket width (which also
/// names the first CSV/JSON column: `day` for a ≥24h bucket, else `hour`). The
/// `Csv` columns are that key plus the store's numeric fields
/// (`…,requests,tokens_in,tokens_out,cache_read,cost_usd`; no cache-write), the
/// `Json` form `{scope,source,total,days|hours}`, and `Table` is the original
/// framing but for `Ink`'s colour. `Json`/`Csv` are never coloured.
pub fn bucket_text(
    rows: &[crate::ocuse::db::Row],
    now_ms: i64,
    lookback_ms: i64,
    size_ms: i64,
    tz_secs: i64,
    colour: bool,
    fmt: Fmt,
) -> String {
    // Buckets are cut in the display timezone: shift, bucket, then label.
    let shift = tz_secs * 1000;
    let mut buckets: std::collections::BTreeMap<i64, Bucket> = Default::default();
    for row in rows {
        let bucket = (row.at_ms + shift).div_euclid(size_ms);
        buckets.entry(bucket).or_default().add(row);
    }
    let start = (now_ms + shift - lookback_ms).div_euclid(size_ms);
    let daily = size_ms >= 86_400_000;
    let label = if daily { "day" } else { "hour" };
    let stamp = |bucket: i64| {
        if daily {
            date_of(bucket)
        } else {
            format!(
                "{} {:02}h",
                date_of(bucket.div_euclid(24)),
                bucket.rem_euclid(24)
            )
        }
    };
    let window: Vec<(i64, Bucket)> = buckets
        .range(start..)
        .map(|(bucket, b)| (*bucket, *b))
        .collect();

    match fmt {
        Fmt::Json => {
            let mut keyed = serde_json::Map::new();
            let mut total = Bucket::default();
            for (bucket, b) in &window {
                keyed.insert(stamp(*bucket), b.json());
                total.add_bucket(b);
            }
            let key = if daily { "days" } else { "hours" };
            serde_json::json!({
                "scope": "local",
                "source": "opencode",
                "total": total.json(),
                key: keyed,
            })
            .to_string()
        }
        Fmt::Csv => {
            let head = if daily { "day" } else { "hour" };
            let mut out = format!("{head},requests,tokens_in,tokens_out,cache_read,cost_usd\n");
            let mut total = Bucket::default();
            for (bucket, b) in &window {
                out.push_str(&format!(
                    "{},{},{},{},{},{:.2}\n",
                    crate::report_render::csv_field(&stamp(*bucket)),
                    b.requests,
                    b.input,
                    b.output,
                    b.cache_read,
                    b.cost,
                ));
                total.add_bucket(b);
            }
            out.push_str(&format!(
                "total,{},{},{},{},{:.2}\n",
                total.requests, total.input, total.output, total.cache_read, total.cost,
            ));
            out
        }
        Fmt::Table => {
            let ink = Ink::new(colour);
            let mut out = format!(
                "{}{label:<12} spend     requests   tokens{}\n",
                ink.bold, ink.reset
            );
            for (bucket, b) in &window {
                out.push_str(&format!(
                    "{:<12} {} {} {}\n",
                    stamp(*bucket),
                    ink.cyan_on(format!("{:>9}", cmduse_core::money(b.cost))),
                    ink.cyan_on(format!("{:>12}", cmduse_core::compact(b.requests))),
                    ink.cyan_on(format!(
                        "{:>9}",
                        cmduse_core::compact(b.input + b.output + b.cache_read)
                    )),
                ));
            }
            if out.lines().count() == 1 {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on("(no OpenCode usage in the window)".into())
                ));
            }
            out
        }
    }
}

/// One session's accumulating totals: `(cost, requests, tokens_in, tokens_out,
/// cache_read, last_ms, distinct models)`.
type SessionTotals<'a> = (
    f64,
    u64,
    u64,
    u64,
    u64,
    i64,
    std::collections::BTreeSet<&'a str>,
);

/// Spend per session, newest first. The `Csv` form is one row per session
/// (`session,requests,tokens_in,tokens_out,cache_read,cost_usd`), `Json` a
/// `{scope,source,sessions}` object whose entries add the last-used instant and
/// the distinct-model count; `Table` keeps its own (last, models) columns.
pub fn session_text(
    rows: &[crate::ocuse::db::Row],
    limit: usize,
    colour: bool,
    fmt: Fmt,
) -> String {
    let mut by_session: std::collections::BTreeMap<&str, SessionTotals> = Default::default();
    for row in rows {
        let entry = by_session
            .entry(row.session.as_str())
            .or_insert_with(|| (0.0, 0, 0, 0, 0, 0, Default::default()));
        entry.0 += row.cost_usd;
        entry.1 += 1;
        entry.2 += row.input;
        entry.3 += row.output;
        entry.4 += row.cache_read;
        entry.5 = entry.5.max(row.at_ms);
        entry.6.insert(row.model.as_str());
    }
    let mut sessions: Vec<_> = by_session.into_iter().collect();
    sessions.sort_by_key(|(_, (_, _, _, _, _, last, _))| std::cmp::Reverse(*last));
    sessions.truncate(limit);

    match fmt {
        Fmt::Json => {
            let mut keyed = serde_json::Map::new();
            for (id, (cost, requests, input, output, cache_read, last, models)) in &sessions {
                let mut body = totals_json(*cost, *requests, *input, *output, *cache_read);
                body["lastMs"] = serde_json::json!(*last);
                body["models"] = serde_json::json!(models.len());
                keyed.insert((*id).to_string(), body);
            }
            serde_json::json!({
                "scope": "local",
                "source": "opencode",
                "sessions": keyed,
            })
            .to_string()
        }
        Fmt::Csv => {
            let mut out =
                String::from("session,requests,tokens_in,tokens_out,cache_read,cost_usd\n");
            for (id, (cost, requests, input, output, cache_read, _, _)) in &sessions {
                out.push_str(&format!(
                    "{},{},{},{},{},{:.2}\n",
                    crate::report_render::csv_field(id),
                    requests,
                    input,
                    output,
                    cache_read,
                    cost,
                ));
            }
            out
        }
        Fmt::Table => {
            let ink = Ink::new(colour);
            let mut out = format!(
                "{}session                          last        models   spend     req{}\n",
                ink.bold, ink.reset
            );
            for (id, (cost, requests, _, _, _, last, models)) in sessions {
                let short = id.rsplit('_').next().unwrap_or(id);
                out.push_str(&format!(
                    "{:<32} {:<11} {:>6} {} {:>6}\n",
                    short,
                    ink.dim_on(format!("{:<11}", date_of(last.div_euclid(86_400_000)))),
                    models.len(),
                    ink.cyan_on(format!("{:>9}", cmduse_core::money(cost))),
                    requests,
                ));
            }
            if out.lines().count() == 1 {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on("(no sessions in the window)".into())
                ));
            }
            out
        }
    }
}

impl Bucket {
    /// Fold another bucket's totals in (for the report's `total` row/entry).
    fn add_bucket(&mut self, other: &Bucket) {
        self.cost += other.cost;
        self.requests += other.requests;
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
    }
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
        crate::ocuse::window::build(&rows, &zen::catalog(), zen::DEFAULT_PLAN, now, None)
    }

    #[test]
    fn text_shows_the_model_against_its_limit() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("glm-5.3-flash"), "{text}");
        assert!(text.contains("$60"), "the model's monthly limit: {text}");
        assert!(text.contains("50%"), "30 of 60 is half: {text}");
    }

    fn meter(status: &str, percent: f64, resets_at: &str) -> crate::ocuse::api::Meter {
        crate::ocuse::api::Meter {
            status: status.into(),
            percent,
            resets_at: Some(resets_at.into()),
        }
    }

    /// The same report with the account's own meters attached — the shape a Go
    /// key produces. Reset instants sit after `now` (2027-01-15T08:00:00Z), so
    /// the countdowns render rather than clamp to zero.
    fn report_with_account() -> Report {
        let mut report = report();
        report.account = Some(crate::ocuse::api::Usage {
            rolling: meter("ok", 5.0, "2027-01-15T12:31:00.000Z"),
            weekly: meter("ok", 59.0, "2027-01-18T00:00:00.000Z"),
            monthly: meter("ok", 29.0, "2027-02-15T08:00:00.000Z"),
        });
        report
    }

    #[test]
    fn the_window_rows_come_from_the_account_when_it_answered() {
        let text = render_text(
            &report_with_account(),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        // The console's three shares, and its reset instants.
        assert!(text.contains("5.0%"), "{text}");
        assert!(text.contains("59.0%"), "{text}");
        assert!(text.contains("29.0%"), "{text}");
        assert!(text.contains("account meters"), "{text}");
        assert!(
            text.contains("resets in 4h 31m"),
            "the 5h block's own end: {text}"
        );
        // The local estimate's aggregate ceilings are gone: their dollars would
        // be a second, disagreeing answer to the same question.
        assert!(!text.contains("$16.00"), "the local 5h cap: {text}");
        assert!(!text.contains("$40.00"), "the local weekly cap: {text}");
        // …and the per-model columns are called out as local, not a second meter.
        assert!(text.contains("not the account's windows"), "{text}");
    }

    #[test]
    fn without_an_account_the_rows_say_they_are_local() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("estimated locally"), "{text}");
        assert!(text.contains("$60.00"), "the local monthly cap: {text}");
        // Nothing claims to be the account's own view.
        assert!(!text.contains("account meters"), "{text}");
        assert!(!text.contains("not the account's windows"), "{text}");
    }

    #[test]
    fn an_over_limit_meter_says_so_before_its_countdown() {
        let mut report = report_with_account();
        if let Some(account) = &mut report.account {
            account.rolling = meter("rate_limited", 100.0, "2027-01-15T12:31:00.000Z");
        }
        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("LIMIT EXCEEDED"), "{text}");
    }

    #[test]
    fn json_carries_the_account_meters_and_null_without_them() {
        let parsed: serde_json::Value =
            serde_json::from_str(&render_json(&report_with_account())).unwrap();
        assert_eq!(parsed["account"]["rolling"]["percent"], 5.0);
        assert_eq!(parsed["account"]["weekly"]["percent"], 59.0);
        assert_eq!(parsed["account"]["monthly"]["status"], "ok");
        // `resetsAt` in epoch ms (the same units as `periodEndAt`), not the ISO
        // string the endpoint sent; `api::tests` pins the literal itself.
        let monthly = cmduse_core::dates::parse_iso_utc("2027-02-15T08:00:00.000Z").unwrap();
        assert_eq!(parsed["account"]["monthly"]["resetsAt"], monthly as i64);

        // No account: the key is present and null, so a consumer can tell the
        // difference between "no key" and "zero".
        let parsed: serde_json::Value = serde_json::from_str(&render_json(&report())).unwrap();
        assert_eq!(parsed["account"], serde_json::Value::Null);
    }

    #[test]
    fn statusline_prefers_the_accounts_share_over_the_local_estimate() {
        let tpl = "{five_hour_pct} {weekly_pct} {month_pct} {five_hour}";
        let account = statusline_template(
            &report_with_account(),
            "go",
            tpl,
            false,
            false,
            DEFAULT_BAR_WIDTH,
        );
        assert!(account.starts_with("5.0% 59.0% 29.0%"), "{account}");
        // Money stays local either way: the endpoint publishes shares, not dollars.
        assert!(account.contains("$30.00"), "{account}");

        // Without an account the same tokens resolve against the store, which is
        // what makes the fallback worth having.
        let local = statusline_template(&report(), "go", tpl, false, false, DEFAULT_BAR_WIDTH);
        assert!(!local.starts_with("5.0%"), "{local}");
    }

    #[test]
    fn json_and_statusline_carry_the_totals() {
        let json = render_json(&report());
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["totals"]["month"]["cost"], 30.0);
        assert_eq!(parsed["models"][0]["id"], "glm-5.3-flash");
        let line = statusline_template(&report(), "go", "{plan} {models}", false, false, 20);
        assert_eq!(line, "go glm-5.3-flash");
    }

    #[test]
    fn json_carries_the_period_bounds() {
        // The default/month report has an end resolved from its own start, and
        // `periodStartAt` is the alias of the existing `periodStart`.
        let mut r = report();
        r.period_end_ms = Some(crate::ocuse::window::next_month(r.since_ms));
        let parsed: serde_json::Value = serde_json::from_str(&render_json(&r)).unwrap();
        assert_eq!(parsed["periodStart"], r.since_ms);
        assert_eq!(parsed["periodStartAt"], r.since_ms);
        assert_eq!(parsed["periodEndAt"], r.period_end_ms.unwrap());

        // `--window all` resolves no end: the key is present and null, and the
        // old keys are unchanged.
        let mut all = report();
        all.period_end_ms = None;
        let parsed: serde_json::Value = serde_json::from_str(&render_json(&all)).unwrap();
        assert_eq!(parsed["periodEndAt"], serde_json::Value::Null);
        assert_eq!(parsed["periodStart"], all.since_ms);
        assert!(parsed.get("periodInferred").is_some());
    }

    /// Every renderer, both ways round: piped/non-tty output must stay free of
    /// SGR escapes, and every one of them must colour when colour is on. This is
    /// the guard for the bug where only `render_text` ever got a colour flag, so
    /// `daily` / `hourly` / `session` / `plans` / `model` / `statusline` printed
    /// plain regardless of the terminal.
    #[test]
    fn every_renderer_respects_the_colour_flag() {
        let mut report = report();
        // Exercise the monthly row's real period (reset, elapsed, by-now) both
        // ways round, so a colour leak into the new plain fields fails here too.
        report.period_end_ms = Some(crate::ocuse::window::next_month(report.since_ms));
        let rows = vec![Row {
            at_ms: report.now_ms - 60_000,
            session: "ses_fixture".into(),
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 30.0,
            ..Default::default()
        }];
        let now = report.now_ms;

        let cases: Vec<(&str, String, String)> = vec![
            (
                "render_text",
                render_text(&report, "/tmp/oc.db", 10, false, DEFAULT_BAR_WIDTH),
                render_text(&report, "/tmp/oc.db", 10, true, DEFAULT_BAR_WIDTH),
            ),
            (
                "statusline_template",
                statusline_template(
                    &report,
                    "go",
                    "{period} {month} {month_pct}",
                    false,
                    false,
                    20,
                ),
                statusline_template(
                    &report,
                    "go",
                    "{period} {month} {month_pct}",
                    true,
                    false,
                    20,
                ),
            ),
            (
                "compact_line",
                compact_line(&report, &[], false),
                compact_line(&report, &[], true),
            ),
            ("plans_text", plans_text(false), plans_text(true)),
            (
                "model_text",
                model_text(&report, "glm-5.3-flash", false),
                model_text(&report, "glm-5.3-flash", true),
            ),
            (
                "bucket_text/day",
                bucket_text(&rows, now, 7 * 86_400_000, 86_400_000, 0, false, Fmt::Table),
                bucket_text(&rows, now, 7 * 86_400_000, 86_400_000, 0, true, Fmt::Table),
            ),
            (
                "bucket_text/hour",
                bucket_text(&rows, now, 3_600_000, 3_600_000, 0, false, Fmt::Table),
                bucket_text(&rows, now, 3_600_000, 3_600_000, 0, true, Fmt::Table),
            ),
            (
                "session_text",
                session_text(&rows, 20, false, Fmt::Table),
                session_text(&rows, 20, true, Fmt::Table),
            ),
            (
                "models_text",
                models_text("go", false, false),
                models_text("go", false, true),
            ),
        ];

        for (name, plain, coloured) in cases {
            assert!(
                !plain.contains('\x1b'),
                "{name} leaked escapes when off: {plain}"
            );
            assert!(
                coloured.contains('\x1b'),
                "{name} rendered nothing coloured when on: {coloured}"
            );
        }

        // Machine formats must ignore the colour flag entirely: no escapes
        // whether it is off or on.
        let flagged: Vec<(&str, String, String)> = vec![
            (
                "bucket_text/day csv",
                bucket_text(&rows, now, 7 * 86_400_000, 86_400_000, 0, false, Fmt::Csv),
                bucket_text(&rows, now, 7 * 86_400_000, 86_400_000, 0, true, Fmt::Csv),
            ),
            (
                "bucket_text/hour json",
                bucket_text(&rows, now, 3_600_000, 3_600_000, 0, false, Fmt::Json),
                bucket_text(&rows, now, 3_600_000, 3_600_000, 0, true, Fmt::Json),
            ),
            (
                "session_text csv",
                session_text(&rows, 20, false, Fmt::Csv),
                session_text(&rows, 20, true, Fmt::Csv),
            ),
            (
                "session_text json",
                session_text(&rows, 20, false, Fmt::Json),
                session_text(&rows, 20, true, Fmt::Json),
            ),
        ];
        for (name, off, on) in flagged {
            assert!(
                !off.contains('\x1b'),
                "{name} leaked escapes with colour off: {off}"
            );
            assert!(
                !on.contains('\x1b'),
                "{name} must stay uncoloured with colour on: {on}"
            );
        }
        for (name, out) in [
            ("model_report json", model_report(&report, None, Fmt::Json)),
            ("model_report csv", model_report(&report, None, Fmt::Csv)),
            ("plans_json", plans_json()),
            ("statusline_json", statusline_json(&report, "go")),
            ("models_json", models_json("go", false)),
        ] {
            assert!(
                !out.contains('\x1b'),
                "{name} must never be coloured: {out}"
            );
        }
    }

    #[test]
    fn bucket_reports_carry_the_documented_columns() {
        let now = 1_800_000_000_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 1.5,
            input: 10,
            output: 20,
            cache_read: 30,
            cache_write: 40,
            ..Default::default()
        }];
        let csv = bucket_text(&rows, now, 7 * 86_400_000, 86_400_000, 0, false, Fmt::Csv);
        assert!(
            csv.starts_with("day,requests,tokens_in,tokens_out,cache_read,cost_usd\n"),
            "{csv}"
        );
        // cache-write is absent from the columns by design; the total row closes.
        assert!(!csv.contains("cache_write"), "{csv}");
        assert!(csv.contains(",10,20,30,1.50\n"), "{csv}");
        assert!(csv.trim_end().ends_with("total,1,10,20,30,1.50"), "{csv}");

        let json: serde_json::Value = serde_json::from_str(&bucket_text(
            &rows,
            now,
            7 * 86_400_000,
            86_400_000,
            0,
            false,
            Fmt::Json,
        ))
        .unwrap();
        assert_eq!(json["total"]["requests"], 1);
        assert_eq!(json["total"]["cacheRead"], 30);
        assert_eq!(json["days"].as_object().unwrap().len(), 1);
    }

    #[test]
    fn session_report_json_and_csv_agree_with_the_store() {
        let now = 1_800_000_000_000;
        let rows = vec![
            Row {
                at_ms: now - 60_000,
                session: "ses_first".into(),
                model: "glm-5.3-flash".into(),
                cost_usd: 2.0,
                input: 5,
                output: 6,
                cache_read: 7,
                ..Default::default()
            },
            Row {
                at_ms: now - 30_000,
                session: "ses_second".into(),
                model: "kimi-k3".into(),
                cost_usd: 1.0,
                ..Default::default()
            },
        ];
        let json: serde_json::Value =
            serde_json::from_str(&session_text(&rows, 20, false, Fmt::Json)).unwrap();
        assert_eq!(json["sessions"]["ses_first"]["tokensIn"], 5);
        assert_eq!(json["sessions"]["ses_first"]["models"], 1);
        assert_eq!(json["sessions"]["ses_second"]["costUsd"], 1.0);
        let csv = session_text(&rows, 20, false, Fmt::Csv);
        assert!(
            csv.starts_with("session,requests,tokens_in,tokens_out,cache_read,cost_usd\n"),
            "{csv}"
        );
        assert!(csv.contains("ses_second,1,0,0,0,1.00\n"), "{csv}");
    }

    #[test]
    fn model_report_projects_the_report_models() {
        let json: serde_json::Value =
            serde_json::from_str(&model_report(&report(), None, Fmt::Json)).unwrap();
        assert_eq!(json["source"], "opencode");
        assert_eq!(json["models"]["glm-5.3-flash"]["costUsd"], 30.0);
        assert_eq!(json["models"]["glm-5.3-flash"]["limit"], 60.0);
        let csv = model_report(&report(), None, Fmt::Csv);
        assert!(csv.contains("glm-5.3-flash,1,0,0,0,30.00\n"), "{csv}");
        // An id that never ran yields just the header, not a stray row.
        assert_eq!(
            model_report(&report(), Some("nope"), Fmt::Csv),
            "model,requests,tokens_in,tokens_out,cache_read,cost_usd\n"
        );
    }

    #[test]
    fn catalogue_json_carries_both_plans_and_windows() {
        let json: serde_json::Value = serde_json::from_str(&plans_json()).unwrap();
        assert_eq!(json["windows"]["fiveHour"], 0.2);
        assert_eq!(json["windows"]["monthly"], 1.0);
        assert_eq!(json["plans"][0]["id"], "go");
        assert_eq!(json["plans"][0]["allowanceByModel"]["glm-5.3-flash"], 60.0);
        assert_eq!(json["plans"][1]["priceUsd"], 40.0);
        assert!(!json["models"].as_array().unwrap().is_empty());
        assert!(!json["zen"].as_array().unwrap().is_empty());
    }

    #[test]
    fn models_lists_the_plan_and_marks_granted() {
        // The ungated table lists every catalogued model and marks the granted.
        let all = models_text("go", false, false);
        assert!(all.contains("glm-5.3-flash"), "{all}");
        assert!(all.contains("GRANTED"), "{all}");
        // The gated list keeps only what the plan grants.
        let gated = models_text("go", true, false);
        for line in gated.lines().skip(2) {
            assert!(
                line.trim_end().ends_with("yes"),
                "ungranted row kept: {line}"
            );
        }
        // JSON: one object per line, and gated drops the ungranted.
        let every: Vec<serde_json::Value> = models_json("go", false)
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert!(every.iter().any(|m| m["granted"] == false));
        assert!(every
            .iter()
            .any(|m| m["id"] == "glm-5.3-flash" && m["limit"] == 60.0));
        let only: Vec<serde_json::Value> = models_json("go", true)
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert!(!only.is_empty());
        assert!(only.iter().all(|m| m["granted"] == true));
    }

    #[test]
    fn statusline_json_mirrors_the_template_numbers() {
        let json: serde_json::Value =
            serde_json::from_str(&statusline_json(&report(), "go")).unwrap();
        assert_eq!(json["plan"], "go");
        assert_eq!(json["period"], "calendar month");
        assert_eq!(json["monthSpent"], 30.0);
        assert_eq!(json["monthCap"], 60.0);
        assert_eq!(json["model"], "glm-5.3-flash");
    }

    #[test]
    fn plain_frames_carry_no_escapes() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(
            !text.contains('\x1b'),
            "piped output must stay plain: {text}"
        );
        // The gauge is colour-only; the plain frame keeps the old percentage text.
        assert!(text.contains("50%"), "{text}");
    }

    /// The monthly row is the only one with a real period end, so it alone gains
    /// the reset, the elapsed share and the pro-rata "$X by now"; the rolling
    /// windows have no boundary and must not invent one.
    #[test]
    fn monthly_row_carries_the_real_period_metrics() {
        let mut r = report();
        r.period_end_ms = Some(crate::ocuse::window::next_month(r.since_ms));
        let text = render_text(&r, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);

        let monthly = text
            .lines()
            .find(|line| line.trim_start().starts_with("Monthly"))
            .expect("the monthly row");
        assert!(monthly.contains("resets"), "{monthly}");
        assert!(
            monthly.contains("window") && monthly.contains("% elapsed"),
            "the real period gives an elapsed share: {monthly}"
        );
        assert!(
            monthly.contains("by now"),
            "monthly is the pro-rata budget: {monthly}"
        );

        for label in ["5-hour", "Weekly"] {
            let row = text
                .lines()
                .find(|line| line.trim_start().starts_with(label))
                .unwrap_or_else(|| panic!("the {label} row"));
            assert!(!row.contains("elapsed"), "{label} has no boundary: {row}");
            assert!(!row.contains("by now"), "{label} is a throttle: {row}");
        }
    }

    /// The period header splits tokens like cmduse and names the resolved end
    /// date when the period has one (`--window all` has none).
    #[test]
    fn period_line_splits_tokens_and_shows_the_end_date() {
        let mut r = report();
        r.period_end_ms = Some(crate::ocuse::window::next_month(r.since_ms));
        let text = render_text(&r, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let header = text
            .lines()
            .find(|line| line.starts_with("period:"))
            .expect("the period line");
        assert!(
            header.contains(" in / "),
            "token split like cmduse: {header}"
        );
        assert!(header.contains(" out tokens"), "{header}");
        assert!(
            header.contains(&date_of(r.period_end_ms.unwrap() / 86_400_000)),
            "the resolved end date: {header}"
        );

        // No end resolved: no date is invented.
        let no_end = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let header = no_end
            .lines()
            .find(|line| line.starts_with("period:"))
            .expect("the period line");
        assert!(!header.contains("ends"), "{header}");
    }

    #[test]
    fn an_over_cap_window_is_flagged_in_both_modes() {
        // 30 spent against a 5-hour cap of 20% of the $60 limit = $12.
        let plain = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(plain.contains("LIMIT EXCEEDED"), "{plain}");
        let coloured = render_text(&report(), "/tmp/opencode.db", 10, true, DEFAULT_BAR_WIDTH);
        assert!(coloured.contains("LIMIT EXCEEDED"), "{coloured}");
        assert!(
            coloured.contains(crate::render::RED),
            "the flag and the gauge are red: {coloured}"
        );
    }

    #[test]
    fn a_model_over_any_of_its_own_windows_is_flagged() {
        // The fixture is at 50% of the month but over the 5-hour share, and Go
        // meters per model per window: the row must say so, not just glow red.
        let plain = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let row = plain
            .lines()
            .find(|line| line.starts_with("glm-5.3-flash"))
            .expect("the model row");
        assert!(row.contains("LIMIT EXCEEDED"), "{row}");
        // Share last, flag early: the informational column is clipped first.
        assert!(row.trim_end().ends_with('%'), "share ends the row: {row}");
    }

    #[test]
    fn a_model_within_its_limits_is_not_flagged() {
        let now = 1_800_000_000_000;
        // $5 against a $60 limit: every window is comfortably inside its share.
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 5.0,
            ..Default::default()
        }];
        let report =
            crate::ocuse::window::build(&rows, &zen::catalog(), zen::DEFAULT_PLAN, now, None);
        for colour in [false, true] {
            let text = render_text(&report, "/tmp/opencode.db", 10, colour, DEFAULT_BAR_WIDTH);
            assert!(!text.contains("LIMIT EXCEEDED"), "colour={colour}: {text}");
        }
    }

    #[test]
    fn the_model_detail_spells_out_the_share() {
        let detail = model_text(&report(), "glm-5.3-flash", false);
        assert!(detail.contains("100.0% of period spend"), "{detail}");
        // A period with nothing to divide by omits the row rather than printing NaN.
        let empty = crate::ocuse::window::build(
            &[],
            &zen::catalog(),
            zen::DEFAULT_PLAN,
            1_800_000_000_000,
            None,
        );
        assert!(!model_text(&empty, "glm-5.3-flash", false).contains("share"));
    }

    #[test]
    fn colour_frames_get_the_palette_and_a_gauge() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, true, DEFAULT_BAR_WIDTH);
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
            DEFAULT_BAR_WIDTH,
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
        let all_idle = watch_frame(
            &report(),
            "/tmp/opencode.db",
            10,
            true,
            &[0.0, 0.0],
            10,
            DEFAULT_BAR_WIDTH,
        );
        assert!(!all_idle.contains("spend bursts"), "{all_idle}");
        let first_frame = watch_frame(
            &report(),
            "/tmp/opencode.db",
            10,
            true,
            &[],
            10,
            DEFAULT_BAR_WIDTH,
        );
        assert!(!first_frame.contains("spend bursts"), "{first_frame}");
    }

    /// Every statusline placeholder resolves, unknown ones are dropped, and
    /// colours off means no SGR at all. The default template is the one the
    /// config ships, so it must render end to end.
    #[test]
    fn statusline_resolves_every_placeholder() {
        let r = report();
        let line = |tpl: &str| statusline_template(&r, "go", tpl, false, false, 20);

        // {plan} {period} are plain text
        assert_eq!(line("{plan}"), "go");
        assert_eq!(line("{period}"), "calendar month");
        // money placeholders reuse cmduse_core::money
        assert_eq!(line("{month}"), "$30.00");
        assert_eq!(line("{five_hour}"), "$30.00");
        assert_eq!(line("{weekly}"), "$30.00");
        // {models} is the top model by spend
        assert_eq!(line("{models}"), "glm-5.3-flash");
        // percentages are one decimal; the fixture is 50% of its $60 limit
        assert_eq!(line("{month_pct}"), "50.0%");
        // bars render at the requested width (non-ascii default gauge glyphs)
        let bar = line("{month_bar}");
        assert!(bar.contains("50.0%") && bar.contains('━'), "{bar}");

        // the default template resolves as a whole
        let default = line("{period} {month} · 5h {five_hour} · wk {weekly}");
        assert_eq!(default, "calendar month $30.00 · 5h $30.00 · wk $30.00");

        // unknown placeholders drop; text and separators pass through
        assert_eq!(line("{plan} {bogus} | tail"), "go  | tail");
        // unclosed brace is emitted verbatim
        assert_eq!(line("{plan} {oops"), "go {oops");
        // with colours off there is no escape anywhere
        assert!(!line("{plan} {month} {month_pct} {month_bar}").contains('\x1b'));
    }

    /// A period with no spend has no aggregate cap to divide by, so the pct
    /// placeholders degrade to the money-less dash instead of NaN.
    #[test]
    fn statusline_without_caps_degrades_gracefully() {
        let empty = crate::ocuse::window::build(
            &[],
            &zen::catalog(),
            zen::DEFAULT_PLAN,
            1_800_000_000_000,
            None,
        );
        let line = statusline_template(&empty, "go", "{month_pct} {models}", false, false, 20);
        assert_eq!(line, "— —");
    }

    /// The one-line compact frame is a single line and inlines the sparkline.
    #[test]
    fn compact_line_is_one_line_with_inline_sparkline() {
        let plain = compact_line(&report(), &[], true);
        assert_eq!(plain.lines().count(), 1, "{plain}");
        assert!(!plain.ends_with('\n'), "{plain}");
        let bursty = compact_line(&report(), &[0.0, 1.5], true);
        assert!(bursty.contains('█'), "nonzero delta shows: {bursty}");
        // colour off ⇒ no escapes; colour on ⇒ the palette appears
        assert!(!compact_line(&report(), &[], false).contains('\x1b'));
        assert!(compact_line(&report(), &[], true).contains(crate::render::BOLD));
    }
}
