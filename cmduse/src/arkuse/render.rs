// arkuse's presentation: a watch frame, a one-shot dashboard, a status line, and
// JSON.
//
// Reuses cmduse-core's pure formatters (compact/pct/duration) and cmduse's own
// palette, gauge and sparkline, so all three binaries read the same. ARK's unit
// is AFP — the plan's own currency — so no row prints `money()`'s `$`; yuan
// appears only where a price is meant (1 AFP = ¥0.002 at every tier).
use crate::arkuse::ark;
use crate::arkuse::window::{Report, Totals};
use crate::report_render::Fmt;
use cmduse_core::{compact, duration, pct};

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

    fn cyan_on(&self, text: String) -> String {
        format!("{}{text}{}", self.cyan, self.reset)
    }

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

    /// The percentage plus cmduse's gauge, and the row's only percentage in
    /// colour mode — the body drops its own `x% of limit` so the figure is not
    /// printed twice. The label is passed in because ARK's meter is the control
    /// plane's own figure (`given_pct`, so `53` never becomes `53.0`) while a
    /// local estimate carries our one decimal. Empty when colour is off, so the
    /// plain frame keeps its script-friendly column layout and its own share.
    fn bar_label(&self, pct_used: f64, label: &str) -> String {
        if !self.colour {
            return String::new();
        }
        format!(
            "{}{label:>5}%{} {}",
            self.for_pct(pct_used),
            self.reset,
            crate::render::gauge(pct_used, 100.0, self.bar_width),
        )
    }
}

/// AFP with thousands separators and no decimals. AFP is a countable quota, not
/// a currency: a tenth of a point is below the control plane's own noise (it
/// reports fractions, the console floors them).
pub fn afp(value: f64) -> String {
    let rounded = value.round() as i64;
    let digits = rounded.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    if rounded < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// Yuan, for prices only — never for metered usage, which is AFP.
pub fn yuan(value: f64) -> String {
    format!("¥{:.2}", (value * 100.0).round() / 100.0)
}

/// A percentage exactly as the control plane published it. ARK serves fractions
/// (`29.756678`), so this keeps one decimal; local percentages keep `pct`'s own
/// formatting.
fn given_pct(value: f64) -> String {
    if (value - value.round()).abs() < 1e-9 {
        format!("{}", value.round() as i64)
    } else {
        format!("{value:.1}")
    }
}

/// `YYYY-MM-DD` for a Unix day number — `cmduse_core::dates::civil_from_days`,
/// so the three binaries cannot drift on the calendar.
pub fn date_of(day: i64) -> String {
    cmduse_core::dates::civil_from_days(day)
}

fn shorten(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if path.starts_with(&home) => format!("~{}", &path[home.len()..]),
        _ => path.to_string(),
    }
}

/// The account meter's window boundary: its reset instant and the window's
/// length, so the row can measure elapsed share and pace on the server's clock.
fn meter_reset(meter: &crate::arkuse::api::Meter, dur_secs: Option<u64>) -> Option<(i64, u64)> {
    match (meter.reset_ms(), dur_secs) {
        (Some(at), Some(dur)) if dur > 0 => Some((at, dur)),
        _ => None,
    }
}

/// A locally cut window's boundary: the oldest row still inside the cut plus the
/// window's length, matching the Go side's rolling reset. `None` when the window
/// holds no rows, because `now + length` is not a reset the data supports.
fn rolling(report: &Report, totals: &Totals, dur_secs: i64) -> Option<(i64, u64)> {
    report
        .rolling_reset(totals, dur_secs)
        .map(|at| (at, dur_secs as u64))
}

#[allow(clippy::too_many_arguments)]
/// One window row's inputs. The control plane's meters and the local estimate
/// both go through this one builder, so the two branches cannot drift apart in
/// which fields a row carries or in the order it carries them.
///
/// Unlike Go, ARK publishes the quota itself (`total`), so the row can print a
/// true `used / quota` pair and a pace against it. The local branch has no
/// quota — it shows AFP alone, never a denominator this store cannot know.
struct RowSpec<'a> {
    label: &'a str,
    /// This store's own totals for the window.
    used: &'a Totals,
    /// The account's meter, when it answered.
    meter: Option<&'a crate::arkuse::api::Meter>,
    /// The window's reset instant and its length in seconds.
    reset: Option<(i64, u64)>,
    /// The plan's published quota for this window, used only when no meter
    /// answered — ARK publishes the split, so the local estimate can print the
    /// same `used / quota` pair the console does instead of AFP alone.
    quota: Option<f64>,
    /// Whether an even-burn figure belongs on this row: the monthly window alone
    /// is a budget, where "what even burn would have spent by now" is a fair
    /// comparison; the throttles above it would read as a spend target.
    pro_rata: bool,
}

fn window_line(ink: &Ink, spec: &RowSpec<'_>, now_ms: i64, catalog: &ark::Catalog) -> String {
    let now_secs = (now_ms / 1000).max(0) as u64;
    let reset_at = spec.reset.map(|(at, _)| at as f64);
    let dur_secs = spec.reset.map(|(_, dur)| dur);
    let elapsed = dur_secs.and_then(|d| cmduse_core::elapsed_pct(reset_at, d, Some(now_secs)));
    let reset = spec
        .reset
        .map(|(at, _)| duration(((at - now_ms) / 1000).max(0) as u64))
        .unwrap_or_default();
    let reset_text = if reset.is_empty() {
        String::new()
    } else if ink.colour {
        format!(" · resets in {reset}")
    } else {
        format!(" · resets {reset}")
    };
    let thru = elapsed
        .map(|p| format!(" · {}window {p:.1}% elapsed{}", ink.dim, ink.reset))
        .unwrap_or_default();
    // This store's AFP against the plan's published quota: the local branch's
    // percentage. It under-reads the console (the meter counts every client and
    // bills at its own coefficient), which is why the row says `est.`.
    let local_pct = spec
        .quota
        .filter(|quota| *quota > 0.0)
        .map(|quota| spec.used.afp / quota * 100.0);

    // Server branch: the quota is the server's own, so the pair and the pace are
    // exact. Local branch: the catalogue's quota, labelled as the estimate it is.
    let (body, tone, pct) = match spec.meter {
        Some(meter) => {
            let pace = spec
                .reset
                .and_then(|(at, d)| {
                    cmduse_core::pace_eta(Some(at as f64), d, meter.used, meter.quota, now_secs)
                        .map(|secs| duration(secs as u64))
                })
                .map(|eta| format!(" · {}on pace to hit cap in {eta}{}", ink.yellow, ink.reset))
                .unwrap_or_default();
            let by_now = match (spec.pro_rata, elapsed) {
                (true, Some(p)) => format!(
                    " · {}{} by now{}",
                    ink.dim,
                    afp(meter.quota * p / 100.0),
                    ink.reset
                ),
                _ => String::new(),
            };
            let flag = if meter.exceeded() {
                format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
            } else if !meter.status.eq_ignore_ascii_case("ok") {
                format!(" {}{}{}{}", ink.red, meter.status, ink.reset, "")
            } else {
                String::new()
            };
            let pct_tone = ink.for_pct(meter.percent);
            let share = if ink.colour {
                // The gauge already carries the share; printing it again here is
                // the duplication this row used to read as `28.5% ━━━ 28.5% of limit`.
                String::new()
            } else {
                format!(
                    " · {}{}% of limit{}",
                    pct_tone,
                    given_pct(meter.percent),
                    ink.reset
                )
            };
            let tail = format!("{reset_text}{flag}{pace}{thru}{by_now}");
            let body = format!(
                "{} / {} AFP{share} · {}{} local{}{tail}",
                afp(meter.used),
                afp(meter.quota),
                ink.dim,
                afp(spec.used.afp),
                ink.reset,
            );
            (body, pct_tone, Some(meter.percent))
        }
        None => {
            let quota = spec.quota.filter(|quota| *quota > 0.0);
            let head = match (quota, local_pct) {
                (Some(quota), Some(p)) => {
                    let share = if ink.colour {
                        format!("{}(est.){}", ink.dim, ink.reset)
                    } else {
                        format!(" · {}{p:.1}% of limit (est.){}", ink.for_pct(p), ink.reset)
                    };
                    format!("{} / {} AFP{share}", afp(spec.used.afp), afp(quota),)
                }
                _ => format!("{} AFP", afp(spec.used.afp)),
            };
            let pace = match (spec.reset, quota, local_pct) {
                (Some((at, d)), Some(quota), Some(_)) => {
                    cmduse_core::pace_eta(Some(at as f64), d, spec.used.afp, quota, now_secs)
                        .map(|secs| {
                            format!(
                                " · {}on pace to hit cap in {}{}",
                                ink.yellow,
                                duration(secs as u64),
                                ink.reset
                            )
                        })
                        .unwrap_or_default()
                }
                _ => String::new(),
            };
            let by_now = match (spec.pro_rata, quota, elapsed) {
                (true, Some(quota), Some(p)) => {
                    format!(
                        " · {}{} by now{}",
                        ink.dim,
                        afp(quota * p / 100.0),
                        ink.reset
                    )
                }
                _ => String::new(),
            };
            let body = format!(
                "{head} · {}{} · {} requests{}{pace}{reset_text}{thru}{by_now}",
                ink.dim,
                yuan(catalog.yuan(spec.used.afp)),
                compact(spec.used.requests),
                ink.reset,
            );
            (body, ink.for_pct(local_pct.unwrap_or(0.0)), local_pct)
        }
    };
    if ink.colour {
        let bar = pct
            .map(|p| {
                let label = match spec.meter {
                    Some(meter) => given_pct(meter.percent),
                    None => format!("{p:.1}"),
                };
                format!("{} ", ink.bar_label(p, &label))
            })
            .unwrap_or_default();
        format!(
            " {}{:<8}{} {}{}{body}{}\n",
            ink.bold, spec.label, ink.reset, bar, tone, ink.reset,
        )
    } else {
        format!("  {:<8} {body}\n", spec.label)
    }
}

/// One model's row: id, coefficient in force, AFP and requests this period. No
/// per-model limit exists on ARK — the quota is plan-level — so there is no USE
/// column to invent. The share of *period* AFP moved to `top_models`, so this
/// row states only what this model itself did.
fn model_row(ink: &Ink, model: &crate::arkuse::window::ModelUsage) -> String {
    let coef = format!("{:>5.2}", model.coef);
    let coef_cell = if ink.colour {
        format!("{}{coef}{}", ink.cyan, ink.reset)
    } else {
        coef
    };
    format!(
        "{:<28} {coef_cell} {:>9} {:>7}\n",
        model.id,
        afp(model.month.afp),
        compact(model.month.requests),
    )
}

/// The period's three biggest models, with their share of *all* use — month AFP
/// in one column pair, tokens (input + output) in the other.
///
/// The share used to hang off each model row as a single trailing `%` of AFP.
/// It moved here because a share only means something against the whole, and
/// the whole is what this block states; the row table below is per model with no
/// limit to divide by (the quota is plan-level, not per model). Tokens are
/// counted without cache reads: those run an order of magnitude larger and
/// would make every AFP share look like a rounding error.
fn top_models(ink: &Ink, report: &Report, count: usize) -> String {
    let tokens = |model: &crate::arkuse::window::ModelUsage| model.month.input + model.month.output;
    let total_afp = report.month.afp;
    let total_tokens: u64 = report.models.iter().map(tokens).sum();
    if report.models.is_empty() || (total_afp <= 0.0 && total_tokens == 0) {
        return String::new();
    }
    let mut out = format!(
        "\n{}TOP {} MODELS{} {} {} {} {}\n",
        ink.bold,
        count,
        ink.reset,
        ink.dim_on(format!("{:<15}", "by month AFP")),
        ink.dim_on(format!("{:>9}", "AFP")),
        ink.dim_on(format!("{:>8}", "SHARE")),
        ink.dim_on(format!("{:>10} {:>8}", "TOKENS", "SHARE")),
    );
    for model in report.models.iter().take(count) {
        let afp_cell = ink.cyan_on(format!(
            "{:>9} {:>8}",
            afp(model.month.afp),
            pct(model.month.afp, total_afp),
        ));
        out.push_str(&format!(
            "{:<28} {afp_cell} {:>10} {:>8}\n",
            model.id,
            compact(tokens(model)),
            pct(tokens(model) as f64, total_tokens as f64),
        ));
    }
    out
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
    let catalog = ark::catalog();
    let c = |text: String| ink.cyan_on(text);
    let mut out = String::new();
    let tier_label = catalog
        .plan(&report.tier)
        .map(|p| p.label.clone())
        .unwrap_or_else(|| report.tier.clone());
    out.push_str(&format!(
        "{}Volcengine ARK usage{} — agent plan {}, from {}{}{}\n",
        ink.bold,
        ink.reset,
        tier_label,
        ink.dim,
        shorten(db_path),
        ink.reset,
    ));
    let end = report
        .period_end_ms
        .map(|ms| {
            format!(
                " · ends {}",
                date_of((ms + report.offset_secs * 1000).div_euclid(86_400_000))
            )
        })
        .unwrap_or_default();
    let start = date_of((report.since_ms + report.offset_secs * 1000).div_euclid(86_400_000));
    // The period line states the one share the whole dashboard is about: how
    // much of the plan's monthly quota is gone. It is the control plane's own
    // number, so it prints as it arrived (`53`, never `53.0`) and is absent —
    // not estimated — when no account answered, because the local cut has no
    // quota of its own to divide by.
    let used = report
        .account
        .as_ref()
        .map(|account| format!(" · {}% of limit", c(given_pct(account.monthly.percent))))
        .unwrap_or_default();
    out.push_str(&format!(
        "period: {start}{end} · {} requests · {} AFP ({}) · {} in / {} out tokens{used}\n",
        c(compact(report.month.requests)),
        c(afp(report.month.afp)),
        c(yuan(catalog.yuan(report.month.afp))),
        c(compact(report.month.input)),
        c(compact(report.month.output)),
    ));
    if let Some(plan) = catalog.plan(&report.tier) {
        out.push_str(&format!(
            "{}plan: {} {} · {} AFP/mo · {} · {} windows{}",
            ink.dim,
            plan.label,
            yuan(plan.price),
            afp(plan.afp),
            catalog.currency,
            if report.account.is_some() {
                "metered by the control plane"
            } else {
                "local estimate"
            },
            ink.reset,
        ));
        out.push('\n');
    }

    match &report.account {
        Some(account) => {
            out.push_str(&format!(
                "\n{}AGENT PLAN{} {}\n",
                ink.bold,
                ink.reset,
                ink.dim_on(
                    "(account meters — what the Volcengine console reports; AFP beside them is this store's own estimate)"
                        .into()
                ),
            ));
            let monthly_dur = report
                .period_end_ms
                .map(|end| ((end - report.since_ms) / 1000).max(0) as u64);
            let daily_local = report.daily.clone().unwrap_or_default();
            let mut windows: Vec<(&str, &crate::arkuse::api::Meter, &Totals, Option<u64>, bool)> =
                vec![(
                    "5-hour",
                    &account.five_hour,
                    &report.five_hour,
                    Some(crate::arkuse::window::FIVE_HOUR_SECS as u64),
                    false,
                )];
            if let Some(daily) = &account.daily {
                windows.push((
                    "Daily",
                    daily,
                    &daily_local,
                    Some(crate::arkuse::window::DAY_SECS as u64),
                    false,
                ));
            }
            windows.push((
                "Weekly",
                &account.weekly,
                &report.weekly,
                Some(crate::arkuse::window::WEEKLY_SECS as u64),
                false,
            ));
            windows.push((
                "Monthly",
                &account.monthly,
                &report.month,
                monthly_dur,
                true,
            ));
            for (label, meter, used, dur, pro_rata) in windows {
                // A just-reset block answers without `reset_at` (measured
                // 2026-10-20: `{"label":"5h","total":10000,"percent":0}`), so
                // fall back to the store's own rolling boundary rather than
                // drop the countdown the row is asked for.
                let reset = meter_reset(meter, dur)
                    .or_else(|| dur.and_then(|dur| rolling(report, used, dur as i64)));
                out.push_str(&window_line(
                    &ink,
                    &RowSpec {
                        label,
                        used,
                        meter: Some(meter),
                        reset,
                        quota: None,
                        pro_rata,
                    },
                    report.now_ms,
                    &catalog,
                ));
            }
            // Reconciliation is the point of holding both sources: the meter is
            // account-wide, the store is this machine, so a gap is either another
            // client or an unmodelled item — worth printing, never hidden.
            let mut notes: Vec<String> = Vec::new();
            if let Some(delta) = report.reconcile() {
                notes.push(format!("local vs meter {:+.1}%", delta));
            }
            if let Some(per) = report.afp_per_request() {
                notes.push(format!("{} AFP/request", afp(per)));
            }
            if let Some(burn) = report.burn_per_day() {
                notes.push(format!("{} AFP/day at this pace", afp(burn)));
            }
            if !notes.is_empty() {
                out.push_str(&format!(
                    "{}    {} · {}{}\n",
                    ink.dim,
                    account.profile,
                    notes.join(" · "),
                    ink.reset,
                ));
            }
        }
        None => {
            out.push_str(&format!(
                "\n{}AGENT PLAN{} {}\n",
                ink.bold,
                ink.reset,
                ink.dim_on("(estimated locally: no control-plane answer, so AFP alone)".into()),
            ));
            if let Some(why) = &report.account_error {
                out.push_str(&format!("{}   usage API: {why}{}\n", ink.dim, ink.reset));
            }
            let monthly_dur = report
                .period_end_ms
                .map(|end| ((end - report.since_ms) / 1000).max(0) as u64);
            // No meter: the catalogue's published split stands in for the
            // quota, and the reset comes from the oldest row still inside the
            // rolling cut — never a fabricated `now + length`.
            let five_reset = rolling(
                report,
                &report.five_hour,
                crate::arkuse::window::FIVE_HOUR_SECS,
            );
            let week_reset = rolling(report, &report.weekly, crate::arkuse::window::WEEKLY_SECS);
            out.push_str(&window_line(
                &ink,
                &RowSpec {
                    label: "5-hour",
                    used: &report.five_hour,
                    meter: None,
                    reset: five_reset,
                    quota: report.window_quota(&catalog, catalog.windows.five_hour),
                    pro_rata: false,
                },
                report.now_ms,
                &catalog,
            ));
            out.push_str(&window_line(
                &ink,
                &RowSpec {
                    label: "Weekly",
                    used: &report.weekly,
                    meter: None,
                    reset: week_reset,
                    quota: report.window_quota(&catalog, catalog.windows.weekly),
                    pro_rata: false,
                },
                report.now_ms,
                &catalog,
            ));
            out.push_str(&window_line(
                &ink,
                &RowSpec {
                    label: "Monthly",
                    used: &report.month,
                    meter: None,
                    reset: report.period_end_ms.zip(monthly_dur),
                    quota: report.window_quota(&catalog, catalog.windows.monthly),
                    pro_rata: true,
                },
                report.now_ms,
                &catalog,
            ));
        }
    }

    out.push_str(&top_models(&ink, report, 3));
    out.push_str(&format!(
        "\n{}MODEL                            COEF       AFP     REQ{}\n",
        ink.bold, ink.reset
    ));
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(&ink, model));
    }
    if report.models.len() > rows {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(format!("… {} more", report.models.len() - rows))
        ));
    }
    // The subtlety that makes local AFP disagree with the meter: composition.
    out.push_str(&format!(
        "\n{}\n",
        ink.dim_on(
            "AFP = (input + cache_read + output) × coefficient / 10,000; the coefficient is the plan's own and a promo halves it until its date."
                .into()
        ),
    ));
    if report.account.is_some() {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(
                "The windows are the account's own cuts (5h block, Monday week, subscription month); the model AFP is this machine inside them."
                    .into()
            )
        ));
    } else {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(
                "Windows are rolling 5h / 7d / calendar month cuts, local only — not the control plane's anchors."
                    .into()
            )
        ));
    }
    out
}

/// One watch frame: the dashboard, then an AFP-burst sparkline when the 5-hour
/// figure has moved since the previous refresh. No trailing newline — the caller
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
            "{}AFP bursts ({}s samples){} {}\n",
            ink.dim,
            interval_secs,
            ink.reset,
            crate::render::sparkline(history),
        ));
    }
    out.trim_end_matches('\n').to_string()
}

/// Minimal one-line dashboard for terminals too small for the full frame.
pub fn compact_line(report: &Report, history: &[f64], colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = ark::catalog();
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
    let window_share = match &report.account {
        Some(account) => format!(
            " · 5h {} · wk {} · mo {}",
            ink.cyan_on(format!("{}%", given_pct(account.five_hour.percent))),
            ink.cyan_on(format!("{}%", given_pct(account.weekly.percent))),
            ink.cyan_on(format!("{}%", given_pct(account.monthly.percent))),
        ),
        None => format!(" · 5h {}", ink.cyan_on(afp(report.five_hour.afp))),
    };
    format!(
        "{}ARK{} {} AFP ({}) month{window_share}{spark}",
        ink.bold,
        ink.reset,
        ink.cyan_on(afp(report.month.afp)),
        ink.cyan_on(yuan(catalog.yuan(report.month.afp))),
    )
}

/// arkuse's statusline: cmduse's `{key}` template engine
/// (`report_render::render_template`) resolved against this report's own
/// placeholders.
///
/// Placeholders (case-insensitive):
///   {plan} {tier} {period}                 tier id / period label
///   {month} {month_pct} {month_bar}
///   {five_hour} {five_hour_pct} {five_hour_bar}   (aliases {5h} {5h_pct} {5h_bar})
///   {weekly} {weekly_pct} {weekly_bar}            (aliases {wk} {wk_pct} {wk_bar})
///   {yuan} {yuan_month}                    this store's AFP in yuan
///   {models}                               top model by period AFP
pub fn statusline_template(
    report: &Report,
    plan_id: &str,
    tpl: &str,
    colours: bool,
    ascii: bool,
    bar_width: usize,
) -> String {
    let ink = Ink::new(colours);
    let catalog = ark::catalog();
    let account = report.account.as_ref();
    let quota_of = |share: f64| report.window_quota(&catalog, share);
    // The console's own percentage when it answered, else this store's AFP
    // against the plan's published split — never a dash for a window we can
    // measure ourselves. The plan's quota is public, so this is not a guess.
    let pct_of = |meter: Option<&crate::arkuse::api::Meter>, used: f64, share: f64| match meter {
        Some(meter) => Some(meter.percent),
        None => quota_of(share)
            .filter(|quota| *quota > 0.0)
            .map(|quota| used / quota * 100.0),
    };
    let share_of = |pct: Option<f64>| match pct {
        Some(pct) => format!("{}%", given_pct(pct)),
        None => "—".into(),
    };
    let share_bar = |pct: Option<f64>| match pct {
        Some(pct) => crate::report_render::bar(pct, bar_width, ascii, colours),
        None => String::new(),
    };
    // A window's boundary: the server's reset, else the oldest row still inside
    // the rolling cut plus the window's length.
    let reset_of =
        |meter: Option<&crate::arkuse::api::Meter>, totals: &Totals, dur: i64| match meter
            .and_then(|m| m.reset_ms())
        {
            Some(at) => Some((at, dur as u64)),
            None => report.rolling_reset(totals, dur).map(|at| (at, dur as u64)),
        };
    let eta_of = |reset: Option<(i64, u64)>, used: f64, quota: Option<f64>| -> Option<String> {
        let (at, dur) = reset?;
        let quota = quota?;
        let secs = cmduse_core::pace_eta(
            Some(at as f64),
            dur,
            used,
            quota,
            (report.now_ms / 1000).max(0) as u64,
        )?;
        Some(format!("on pace to hit cap in {}", duration(secs as u64)))
    };
    let h5_pct = pct_of(
        account.map(|a| &a.five_hour),
        report.five_hour.afp,
        catalog.windows.five_hour,
    );
    let wk_pct = pct_of(
        account.map(|a| &a.weekly),
        report.weekly.afp,
        catalog.windows.weekly,
    );
    let month_pct = pct_of(
        account.map(|a| &a.monthly),
        report.month.afp,
        catalog.windows.monthly,
    );
    let h5_eta = eta_of(
        reset_of(
            account.map(|a| &a.five_hour),
            &report.five_hour,
            crate::arkuse::window::FIVE_HOUR_SECS,
        ),
        report.five_hour.afp,
        quota_of(catalog.windows.five_hour),
    )
    .unwrap_or_default();
    let wk_eta = eta_of(
        reset_of(
            account.map(|a| &a.weekly),
            &report.weekly,
            crate::arkuse::window::WEEKLY_SECS,
        ),
        report.weekly.afp,
        quota_of(catalog.windows.weekly),
    )
    .unwrap_or_default();
    let cash = |value: f64| ink.cyan_on(afp(value));
    let top = report
        .models
        .first()
        .map(|m| m.id.clone())
        .unwrap_or_else(|| "—".into());
    let replacements: Vec<(&str, String)> = vec![
        ("plan", plan_id.to_string()),
        ("tier", plan_id.to_string()),
        ("period", report.period_label.clone()),
        ("month", cash(report.month.afp)),
        ("month_pct", share_of(month_pct)),
        ("month_bar", share_bar(month_pct)),
        ("five_hour", cash(report.five_hour.afp)),
        ("5h", cash(report.five_hour.afp)),
        ("five_hour_pct", share_of(h5_pct)),
        ("5h_pct", share_of(h5_pct)),
        ("five_hour_bar", share_bar(h5_pct)),
        ("5h_bar", share_bar(h5_pct)),
        ("5h_eta", h5_eta),
        ("weekly", cash(report.weekly.afp)),
        ("wk", cash(report.weekly.afp)),
        ("weekly_pct", share_of(wk_pct)),
        ("wk_pct", share_of(wk_pct)),
        ("weekly_bar", share_bar(wk_pct)),
        ("wk_bar", share_bar(wk_pct)),
        ("wk_eta", wk_eta),
        ("yuan", yuan(catalog.yuan(report.month.afp))),
        ("yuan_month", yuan(catalog.yuan(report.month.afp))),
        ("models", top),
    ];
    crate::report_render::render_template(tpl, |key| {
        let lower = key.to_ascii_lowercase();
        replacements
            .iter()
            .find(|(name, _)| *name == lower)
            .map(|(_, value)| value.clone())
            .unwrap_or_default()
    })
}

pub fn statusline_json(report: &Report, plan_id: &str) -> String {
    let catalog = ark::catalog();
    let quota_of = |share: f64| report.window_quota(&catalog, share);
    serde_json::json!({
        "plan": plan_id,
        "period": report.period_label,
        "source": "opencode",
        // The shared names a statusline consumer already reads; here they carry
        // AFP, because AFP is this plan's currency. The caps are the plan's
        // published split of its monthly AFP, so a consumer never has to hold a
        // table of its own.
        "monthSpent": report.month.afp,
        "monthCap": quota_of(catalog.windows.monthly),
        "fiveHourSpent": report.five_hour.afp,
        "fiveHourCap": quota_of(catalog.windows.five_hour),
        "weeklySpent": report.weekly.afp,
        "weeklyCap": quota_of(catalog.windows.weekly),
        "model": report.models.first().map(|m| m.id.clone()),
        "afp": {
            "fiveHour": report.five_hour.afp,
            "weekly": report.weekly.afp,
            "monthly": report.month.afp,
            "yuan": catalog.yuan(report.month.afp),
        },
        "account": report.account.as_ref().map(usage_json),
        "accountError": report.account_error,
        "periodEnd": report.period_end_ms,
    })
    .to_string()
}

/// One meter as JSON, with the server's own figures preserved — the percentage
/// is the console's, not a recomputation.
/// One window as this store measures it: AFP, the plan's published quota, the
/// percentage against it, and the boundary its row counts down to.
fn window_json(totals: &Totals, quota: Option<f64>, reset_ms: Option<i64>) -> serde_json::Value {
    serde_json::json!({
        "afp": totals.afp,
        "requests": totals.requests,
        "quota": quota,
        "percent": quota
            .filter(|quota| *quota > 0.0)
            .map(|quota| totals.afp / quota * 100.0),
        "resetAt": reset_ms,
    })
}

fn meter_json(meter: &crate::arkuse::api::Meter) -> serde_json::Value {
    serde_json::json!({
        "used": meter.used,
        "total": meter.quota,
        "percent": meter.percent,
        "status": meter.status,
        "resetsAt": meter.resets_at,
        "resetAt": meter.reset_ms(),
    })
}

/// Every window the control plane answered, keeping the plan's own shape — a
/// text-only workload has no `daily` period, so that key is simply absent.
fn usage_json(usage: &crate::arkuse::api::Usage) -> serde_json::Value {
    serde_json::json!({
        "profile": usage.profile,
        "tier": usage.tier,
        "fiveHour": meter_json(&usage.five_hour),
        "daily": usage.daily.as_ref().map(meter_json),
        "weekly": meter_json(&usage.weekly),
        "monthly": meter_json(&usage.monthly),
    })
}

pub fn render_json(report: &Report) -> String {
    let catalog = ark::catalog();
    let totals = |t: &Totals| {
        serde_json::json!({
            "afp": t.afp,
            "requests": t.requests,
            "tokensIn": t.input,
            "tokensOut": t.output,
            "cacheRead": t.cache_read,
            "cacheWrite": t.cache_write,
        })
    };
    let models: serde_json::Map<String, serde_json::Value> = report
        .models
        .iter()
        .map(|m| {
            (
                m.id.clone(),
                serde_json::json!({
                    "coef": m.coef,
                    "month": totals(&m.month),
                    "fiveHour": totals(&m.five_hour),
                    "weekly": totals(&m.weekly),
                }),
            )
        })
        .collect();
    serde_json::json!({
        "source": "opencode",
        "scope": "local",
        "plan": report.tier,
        "profile": report.profile,
        "periodStart": report.since_ms,
        "periodEndAt": report.period_end_ms,
        "periodEnd": report.period_end_ms
            .map(|ms| date_of((ms + report.offset_secs * 1000).div_euclid(86_400_000))),
        "monthInferred": report.month_inferred,
        "summary": {
            "afp": report.month.afp,
            "yuan": ark::catalog().yuan(report.month.afp),
            "requests": report.month.requests,
            "tokensIn": report.month.input,
            "tokensOut": report.month.output,
            "cacheRead": report.month.cache_read,
        },
        "fiveHour": totals(&report.five_hour),
        "weekly": totals(&report.weekly),
        "monthly": totals(&report.month),
        "daily": report.daily.as_ref().map(totals),
        // This store's view of each window against the plan's published quota —
        // the same pair the dashboard prints, so a consumer without the account
        // answer still gets a percentage and a boundary.
        "windows": {
            "fiveHour": window_json(
                &report.five_hour,
                report.window_quota(&catalog, catalog.windows.five_hour),
                report.rolling_reset(&report.five_hour, crate::arkuse::window::FIVE_HOUR_SECS),
            ),
            "weekly": window_json(
                &report.weekly,
                report.window_quota(&catalog, catalog.windows.weekly),
                report.rolling_reset(&report.weekly, crate::arkuse::window::WEEKLY_SECS),
            ),
            "monthly": window_json(
                &report.month,
                report.window_quota(&catalog, catalog.windows.monthly),
                report.period_end_ms,
            ),
        },
        "account": report.account.as_ref().map(|account| {
            let mut body = serde_json::json!({
                "profile": account.profile,
                "tier": account.tier,
                "fiveHour": meter_json(&account.five_hour),
                "weekly": meter_json(&account.weekly),
                "monthly": meter_json(&account.monthly),
            });
            if let Some(daily) = &account.daily {
                body["daily"] = meter_json(daily);
            }
            body
        }),
        "accountError": report.account_error,
        "reconciledPct": report.reconcile(),
        "afpPerRequest": report.afp_per_request(),
        "models": models,
    })
    .to_string()
}

/// The tier catalogue: what each plan costs, what quota it grants, and how that
/// quota is split across the windows. The window figures are the plan's own
/// fractions of its monthly AFP — the same table the console shows per tier.
pub fn plans_text(colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = ark::catalog();
    let mut out = format!(
        "{}{:<8} {:>9} {:>9} {:>10} {:>10} {:>10}{}\n",
        ink.bold, "TIER", "YUAN/MO", "AFP/MO", "5H AFP", "DAILY AFP", "WK AFP", ink.reset
    );
    for plan in &catalog.plans {
        out.push_str(&format!(
            "{:<8} {:>9} {:>9} {:>10} {:>10} {:>10}\n",
            plan.label,
            ink.cyan_on(yuan(plan.price)),
            ink.cyan_on(afp(plan.afp)),
            afp(plan.afp * catalog.windows.five_hour),
            afp(plan.afp * catalog.windows.daily),
            afp(plan.afp * catalog.windows.weekly),
        ));
        if let Some(promo) = &plan.promo {
            out.push_str(&format!(
                "{}{} for {} months, until {}{}\n",
                ink.dim,
                yuan(promo.price),
                promo.months.unwrap_or(1),
                promo.until,
                ink.reset,
            ));
        }
    }
    out.push_str(&format!(
        "\n{}1 AFP = ¥{:.3} at every tier · 1,000 AFP = {}{}\n",
        ink.dim,
        catalog.afp_yuan,
        yuan(catalog.yuan(1000.0)),
        ink.reset,
    ));
    if !catalog.enterprise.is_empty() {
        out.push_str(&format!(
            "\n{}ENTERPRISE{} {}\n",
            ink.bold,
            ink.reset,
            ink.dim_on(
                "(seat-based; AFP is metered per seat and the personal usage API does not expose it)"
                    .into()
            ),
        ));
        for plan in &catalog.enterprise {
            out.push_str(&format!(
                "  {:<22} {}\n",
                plan.label,
                ink.cyan_on(format!("{}/seat/mo", yuan(plan.price))),
            ));
        }
    }
    if let Some(note) = catalog.notes.get("windows") {
        out.push_str(&format!("\n{}{}{}\n", ink.dim, note, ink.reset));
    }
    out
}

pub fn plans_json() -> String {
    let catalog = ark::catalog();
    serde_json::json!({
        "source": catalog.source,
        "extractedAt": catalog.extracted_at,
        "currency": catalog.currency,
        "afpYuan": catalog.afp_yuan,
        "windows": {
            "fiveHour": catalog.windows.five_hour,
            "daily": catalog.windows.daily,
            "weekly": catalog.windows.weekly,
            "monthly": catalog.windows.monthly,
        },
        "plans": catalog.plans.iter().map(|p| serde_json::json!({
            "id": p.id,
            "label": p.label,
            "price": p.price,
            "listPrice": p.list_price,
            "afp": p.afp,
            "promo": p.promo.as_ref().map(|promo| serde_json::json!({
                "price": promo.price,
                "until": promo.until,
                "months": promo.months,
            })),
        })).collect::<Vec<_>>(),
        "enterprise": catalog.enterprise.iter().map(|p| serde_json::json!({
            "id": p.id,
            "label": p.label,
            "price": p.price,
        })).collect::<Vec<_>>(),
        "modelCount": catalog.models.len(),
    })
    .to_string()
}

/// `y` yuan per million tokens at a coefficient — the same quantity the docs
/// publish per model, so a reader can check a coefficient without arithmetic:
/// 1M tokens × coef / 10,000 = 100·coef AFP, and 1 AFP = ¥0.002.
fn yuan_per_million(coef: f64, afp_yuan: f64) -> f64 {
    1_000_000.0 * coef / 10_000.0 * afp_yuan
}

/// The model catalogue with its coefficient in force today. `gated` keeps only
/// what `plan_id` grants; the table always says which tier a model needs, because
/// the plan you hold changes what you can call.
pub fn models_text(plan_id: &str, gated: bool, colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = ark::catalog();
    let now = crate::arkuse::window::now_ms();
    let mut out = format!(
        "{}{:<30} {:>6} {:>7} {:>10} {:>8} {:>8}{}\n",
        ink.bold, "MODEL", "KIND", "COEF", "YUAN/1M", "MIN", "GRANTED", ink.reset
    );
    for model in &catalog.models {
        let granted = catalog.grants(plan_id, &model.min_plan);
        if gated && !granted {
            continue;
        }
        let coef = ark::effective_coef(model, now);
        let promo = model.promo_coef.map(|_| {
            format!(
                " (promo until {})",
                model.promo_until.as_deref().unwrap_or("?")
            )
        });
        let coef_cell = ink.cyan_on(format!("{coef:.2}"));
        out.push_str(&format!(
            "{:<30} {:>6} {:>7} {:>10} {:>8} {:>8}",
            model.id,
            model.kind,
            coef_cell,
            format!("{:.2}", yuan_per_million(coef, catalog.afp_yuan)),
            model.min_plan,
            if granted { "yes" } else { "no" },
        ));
        if let Some(promo) = promo {
            out.push_str(&format!("{}{promo}{}", ink.dim, ink.reset));
        }
        out.push('\n');
    }
    out
}

/// One JSON object per line, mirroring `models_text` — the shape cmduse's own
/// `models --json` uses, so a consumer pipes either binary the same way.
pub fn models_json(plan_id: &str, gated: bool) -> String {
    let catalog = ark::catalog();
    let now = crate::arkuse::window::now_ms();
    let mut lines: Vec<String> = Vec::new();
    for model in &catalog.models {
        let granted = catalog.grants(plan_id, &model.min_plan);
        if gated && !granted {
            continue;
        }
        let coef = ark::effective_coef(model, now);
        lines.push(
            serde_json::json!({
                "id": model.id,
                "name": model.name,
                "kind": model.kind,
                "coef": coef,
                "baseCoef": model.coef,
                "promoCoef": model.promo_coef,
                "promoUntil": model.promo_until,
                "yuanPerMillion": yuan_per_million(coef, catalog.afp_yuan),
                "minPlan": model.min_plan,
                "granted": granted,
            })
            .to_string(),
        );
    }
    lines.join("\n")
}

/// One model's period record: what it cost in AFP, where that AFP sits in each
/// window, and how much of the period it accounts for.
pub fn model_text(report: &Report, id: &str, colour: bool) -> String {
    let ink = Ink::new(colour);
    let Some(model) = report.models.iter().find(|m| m.id == id) else {
        return format!("{id}: no usage in the period\n");
    };
    let row =
        |label: &str, value: String| format!("  {}{value}\n", ink.dim_on(format!("{label:<10}")));
    let mut out = format!(
        "{} {}\n",
        ink.bold_on(model.id.clone()),
        ink.dim_on(format!("({})", model.provider)),
    );
    out.push_str(&row(
        "coef",
        ink.cyan_on(format!(
            "{:.2} · {} per million tokens",
            model.coef,
            yuan(yuan_per_million(model.coef, ark::catalog().afp_yuan))
        )),
    ));
    out.push_str(&row(
        "month",
        ink.cyan_on(format!(
            "{} AFP ({}) · {} requests",
            afp(model.month.afp),
            yuan(ark::catalog().yuan(model.month.afp)),
            model.month.requests
        )),
    ));
    out.push_str(&row(
        "5-hour",
        ink.cyan_on(format!("{} AFP", afp(model.five_hour.afp))),
    ));
    out.push_str(&row(
        "weekly",
        ink.cyan_on(format!("{} AFP", afp(model.weekly.afp))),
    ));
    if report.month.afp > 0.0 {
        out.push_str(&row(
            "share",
            ink.dim_on(format!(
                "{:.1}% of the period's AFP",
                model.month.afp / report.month.afp * 100.0
            )),
        ));
    }
    out
}

/// Per-model report: `Json` mirrors cmduse's `model --json` envelope with AFP in
/// place of dollars; `Csv` is one row per model. `Table` is the caller's.
pub fn model_report(report: &Report, id: Option<&str>, fmt: Fmt) -> String {
    let models: Vec<&crate::arkuse::window::ModelUsage> = report
        .models
        .iter()
        .filter(|m| id.is_none_or(|want| m.id == want))
        .collect();
    match fmt {
        Fmt::Json => {
            let map: serde_json::Map<String, serde_json::Value> = models
                .iter()
                .map(|m| {
                    (
                        m.id.clone(),
                        serde_json::json!({
                            "coef": m.coef,
                            "requests": m.month.requests,
                            "tokensIn": m.month.input,
                            "tokensOut": m.month.output,
                            "cacheRead": m.month.cache_read,
                            "afp": m.month.afp,
                            "yuan": ark::catalog().yuan(m.month.afp),
                        }),
                    )
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
            let mut out = String::from("model,requests,tokens_in,tokens_out,cache_read,afp\n");
            for m in models {
                out.push_str(&format!(
                    "{},{},{},{},{},{:.2}\n",
                    crate::report_render::csv_field(&m.id),
                    m.month.requests,
                    m.month.input,
                    m.month.output,
                    m.month.cache_read,
                    m.month.afp,
                ));
            }
            out
        }
        Fmt::Table => String::new(),
    }
}

/// The period's per-model breakdown as a table — what `arkuse model` with no id
/// prints. Columns mirror the dashboard's model block so a reader can put the
/// two side by side.
pub fn models_period_text(report: &Report, limit: usize, colour: bool) -> String {
    let ink = Ink::new(colour);
    let mut out = format!(
        "{}{:<28} {:>5} {:>9} {:>7} {:>6}{}\n",
        ink.bold, "MODEL", "COEF", "AFP", "REQ", "SHARE", ink.reset
    );
    let total = report.month.afp;
    for model in report.models.iter().take(limit.min(report.models.len())) {
        let share = if total > 0.0 {
            ink.dim_on(format!("{:>5.1}%", model.month.afp / total * 100.0))
        } else {
            "     -".to_string()
        };
        out.push_str(&format!(
            "{:<28} {} {:>9} {:>7} {}\n",
            model.id,
            ink.cyan_on(format!("{:>5.2}", model.coef)),
            ink.cyan_on(format!("{:>9}", afp(model.month.afp))),
            ink.cyan_on(format!("{:>7}", compact(model.month.requests))),
            share,
        ));
    }
    if report.models.is_empty() {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on("(no agent-plan usage in the period)".into())
        ));
    } else if total > 0.0 {
        if report.models.len() > limit {
            out.push_str(&format!(
                "{}\n",
                ink.dim_on(format!("… {} more", report.models.len() - limit))
            ));
        }
        out.push_str(&format!(
            "{:<28} {:>5} {:>9} {:>7} {:>6}\n",
            ink.bold_on("TOTAL".into()),
            "",
            afp(total),
            compact(report.month.requests),
            "100.0%",
        ));
    }
    out
}

/// The store's numeric fields, in the shape every machine format in this repo
/// uses, with AFP standing where the other binaries put dollars.
fn totals_json(
    afp: f64,
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
        "afp": afp,
    })
}

/// One day/hour bucket. AFP is accumulated per row, because the coefficient is
/// a property of the model and of the day it ran (a promo can expire mid-window).
#[derive(Default, Clone, Copy)]
struct Bucket {
    afp: f64,
    requests: u64,
    input: u64,
    output: u64,
    cache_read: u64,
}

impl Bucket {
    fn add(&mut self, catalog: &ark::Catalog, row: &crate::arkuse::db::Row) {
        self.requests += 1;
        self.input += row.input;
        self.output += row.output;
        self.cache_read += row.cache_read;
        self.afp += catalog
            .afp(&row.model, row.at_ms, row.input, row.cache_read, row.output)
            .unwrap_or(0.0);
    }

    fn merge(&mut self, other: &Bucket) {
        self.afp += other.afp;
        self.requests += other.requests;
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
    }

    fn json(&self) -> serde_json::Value {
        totals_json(
            self.afp,
            self.requests,
            self.input,
            self.output,
            self.cache_read,
        )
    }
}

/// AFP per bucket (day or hour), oldest first — `arkuse daily` / `arkuse hourly`.
#[allow(clippy::too_many_arguments)]
pub fn bucket_text(
    rows: &[crate::arkuse::db::Row],
    catalog: &ark::Catalog,
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
        buckets.entry(bucket).or_default().add(catalog, row);
    }
    let start = (now_ms + shift - lookback_ms).div_euclid(size_ms);
    let daily = size_ms >= crate::arkuse::window::DAY_SECS * 1000;
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
                total.merge(b);
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
            let mut out = format!("{label},requests,tokens_in,tokens_out,cache_read,afp\n");
            let mut total = Bucket::default();
            for (bucket, b) in &window {
                out.push_str(&format!(
                    "{},{},{},{},{},{:.2}\n",
                    crate::report_render::csv_field(&stamp(*bucket)),
                    b.requests,
                    b.input,
                    b.output,
                    b.cache_read,
                    b.afp,
                ));
                total.merge(b);
            }
            out.push_str(&format!(
                "total,{},{},{},{},{:.2}\n",
                total.requests, total.input, total.output, total.cache_read, total.afp,
            ));
            out
        }
        Fmt::Table => {
            let ink = Ink::new(colour);
            let mut out = format!(
                "{}{label:<12} AFP      requests   tokens{}\n",
                ink.bold, ink.reset
            );
            for (bucket, b) in &window {
                out.push_str(&format!(
                    "{:<12} {} {} {}\n",
                    stamp(*bucket),
                    ink.cyan_on(format!("{:>9}", afp(b.afp))),
                    ink.cyan_on(format!("{:>12}", compact(b.requests))),
                    ink.cyan_on(format!("{:>9}", compact(b.input + b.output + b.cache_read))),
                ));
            }
            if out.lines().count() == 1 {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on("(no agent-plan usage in the window)".into())
                ));
            }
            out
        }
    }
}

/// One session's accumulating totals: `(afp, requests, tokens_in, tokens_out,
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

/// AFP per session, newest first — the same columns as `ocuse session`, with AFP
/// in place of USD.
pub fn session_text(
    rows: &[crate::arkuse::db::Row],
    catalog: &ark::Catalog,
    limit: usize,
    colour: bool,
    fmt: Fmt,
) -> String {
    let mut by_session: std::collections::BTreeMap<&str, SessionTotals> = Default::default();
    for row in rows {
        let entry = by_session
            .entry(row.session.as_str())
            .or_insert_with(|| (0.0, 0, 0, 0, 0, 0, Default::default()));
        entry.0 += catalog
            .afp(&row.model, row.at_ms, row.input, row.cache_read, row.output)
            .unwrap_or(0.0);
        entry.1 += 1;
        entry.2 += row.input;
        entry.3 += row.output;
        entry.4 += row.cache_read;
        entry.5 = entry.5.max(row.at_ms);
        entry.6.insert(row.model.as_str());
    }
    let mut sessions: Vec<_> = by_session.into_iter().collect();
    sessions.sort_by_key(|(_, (_, _, _, _, _, last, _))| std::cmp::Reverse(*last));

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
            let mut out = String::from("session,requests,tokens_in,tokens_out,cache_read,afp\n");
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
                "{}session                          last        models   AFP       req{}\n",
                ink.bold, ink.reset
            );
            for (id, (cost, requests, _, _, _, last, models)) in sessions.iter().take(limit) {
                let short = id.rsplit('_').next().unwrap_or(*id);
                out.push_str(&format!(
                    "{:<32} {:<11} {:>6} {} {:>6}\n",
                    short,
                    ink.dim_on(format!("{:<11}", date_of(last.div_euclid(86_400_000)))),
                    models.len(),
                    ink.cyan_on(format!("{:>9}", afp(*cost))),
                    requests,
                ));
            }
            if sessions.len() > limit {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on(format!("… {} more", sessions.len() - limit))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arkuse::db::Row;

    fn report() -> Report {
        let now = 1_800_000_000_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            session: "ses_a".into(),
            provider: "agent-plan".into(),
            model: "deepseek-v4.1-flash".into(),
            input: 10_000,
            output: 2_000,
            ..Default::default()
        }];
        crate::arkuse::window::build(&rows, &ark::catalog(), ark::DEFAULT_PLAN, now, None, None)
    }

    #[test]
    fn text_names_the_model_and_its_afp() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("deepseek-v4.1-flash"), "{text}");
        assert!(text.contains("AFP"), "the plan's own unit: {text}");
        assert!(!text.contains('$'), "ARK never prices in dollars: {text}");
    }

    #[test]
    fn the_tier_table_carries_every_personal_plan() {
        let text = plans_text(false);
        for plan in ark::catalog().plans {
            assert!(text.contains(&plan.label), "{} missing: {text}", plan.label);
        }
        let json: serde_json::Value = serde_json::from_str(&plans_json()).unwrap();
        assert_eq!(
            json["plans"].as_array().unwrap().len(),
            ark::catalog().plans.len()
        );
    }

    #[test]
    fn gated_models_are_filtered_by_the_tier() {
        let all = models_text("small", false, false);
        let gated = models_text("small", true, false);
        assert!(all.lines().count() >= gated.lines().count());
        assert!(all.contains("kimi-k3"), "{all}");
        assert!(!gated.contains("kimi-k3"), "{gated}");
    }

    /// A report measured against the control plane's own meters.
    fn metered(account: &crate::arkuse::api::Usage) -> Report {
        let now = 1_800_000_000_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            session: "ses_a".into(),
            provider: "agent-plan".into(),
            model: "deepseek-v4.1-flash".into(),
            input: 10_000,
            output: 2_000,
            ..Default::default()
        }];
        crate::arkuse::window::build(
            &rows,
            &ark::catalog(),
            ark::DEFAULT_PLAN,
            now,
            None,
            Some(account),
        )
    }

    fn meter(used: f64, quota: f64, reset: Option<&str>) -> crate::arkuse::api::Meter {
        let percent = if quota > 0.0 {
            used / quota * 100.0
        } else {
            0.0
        };
        crate::arkuse::api::Meter::from_parts("ok", percent, used, quota, reset, None)
    }

    /// The shape `cli.rs` assembles once the control plane answered: `build`
    /// cuts the windows from the meters, then the account itself rides on the
    /// report for the header and the AGENT PLAN rows.
    fn metered_account(account: &crate::arkuse::api::Usage) -> Report {
        let mut report = metered(account);
        report.account = Some(account.clone());
        report.period_end_ms = account.monthly.reset_ms();
        report
    }

    #[test]
    fn a_local_row_still_reads_used_over_quota_and_a_reset() {
        // Without the control plane the plan's published split stands in for the
        // quota, so the row is never AFP alone — the parity the user expects.
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let five = text
            .lines()
            .find(|line| line.contains("5-hour"))
            .expect("a 5-hour row");
        assert!(
            five.contains("/ 10,000 AFP"),
            "the plan's own quota: {five}"
        );
        assert!(five.contains("% of limit (est.)"), "a percentage: {five}");
        let weekly = text
            .lines()
            .find(|line| line.contains("Weekly"))
            .expect("a weekly row");
        assert!(weekly.contains("resets"), "a countdown: {weekly}");
        assert!(weekly.contains("window "), "an elapsed share: {weekly}");
        let json: serde_json::Value = serde_json::from_str(&render_json(&report())).unwrap();
        assert_eq!(json["windows"]["fiveHour"]["quota"], 10_000.0);
        assert!(json["windows"]["weekly"]["resetAt"].is_i64());
    }

    #[test]
    fn a_meter_without_its_reset_falls_back_to_the_stores_boundary() {
        // The measured shape: a just-reset 5-hour block answers 0% with no
        // `reset_at`, and the row still owes the countdown.
        let account = crate::arkuse::api::Usage {
            five_hour: meter(0.0, 10_000.0, None),
            daily: None,
            weekly: meter(2_975.67, 35_000.0, Some("2026-10-26T00:00:00+08:00")),
            monthly: meter(2_975.67, 100_000.0, Some("2026-11-19T23:59:59+08:00")),
            tier: Some("medium".into()),
            profile: "agent-plan_cn-beijing_medium".into(),
        };
        let text = render_text(
            &metered(&account),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        let five = text
            .lines()
            .find(|line| line.contains("5-hour"))
            .expect("a 5-hour row");
        assert!(
            five.contains("0% of limit"),
            "the server's own share: {five}"
        );
        assert!(five.contains("resets"), "a derived countdown: {five}");
    }

    /// The period line states the one share the whole dashboard is about — the
    /// control plane's own monthly percentage — and states nothing when no
    /// account answered (the local rows carry their own labelled estimate).
    #[test]
    fn period_line_carries_the_account_monthly_share() {
        // 53,000 of 100,000 AFP: the server's own figure, printed as a whole
        // percent — `53`, never `53.0`.
        let account = crate::arkuse::api::Usage {
            five_hour: meter(0.0, 10_000.0, None),
            daily: None,
            weekly: meter(2_975.67, 35_000.0, Some("2026-10-26T00:00:00+08:00")),
            monthly: meter(53_000.0, 100_000.0, Some("2026-11-19T23:59:59+08:00")),
            tier: Some("medium".into()),
            profile: "agent-plan_cn-beijing_medium".into(),
        };
        let with = render_text(
            &metered_account(&account),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        let header = with
            .lines()
            .find(|line| line.starts_with("period:"))
            .expect("the period line");
        assert!(header.contains("53% of limit"), "{header}");
        assert!(!header.contains("53.0"), "no invented decimal: {header}");

        let without = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let header = without
            .lines()
            .find(|line| line.starts_with("period:"))
            .expect("the period line");
        assert!(
            !header.contains("of limit"),
            "no account, no share: {header}"
        );
    }

    /// The TOP 3 block splits the period between AFP and tokens, and both shares
    /// are of the whole — not of one model's own window.
    #[test]
    fn top_models_state_their_share_of_afp_and_tokens() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let block = text
            .lines()
            .skip_while(|line| !line.starts_with("TOP 3 MODELS"))
            .take_while(|line| !line.starts_with("MODEL "))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(block.contains("deepseek-v4.1-flash"), "{block}");
        assert!(block.contains("AFP") && block.contains("TOKENS"), "{block}");
        // One model takes the whole period, so both shares are 100%.
        assert_eq!(block.matches("100.0%").count(), 2, "{block}");
        // The row under the table header ends on its requests: the share of
        // period AFP moved into the block above it.
        let row = text
            .lines()
            .skip_while(|line| !line.starts_with("MODEL "))
            .find(|line| line.starts_with("deepseek-v4.1-flash"))
            .expect("the model row");
        assert!(!row.trim_end().ends_with('%'), "no trailing share: {row}");
        assert!(row.trim_end().ends_with(char::is_numeric), "{row}");
    }

    #[test]
    fn the_bar_carries_the_share_so_the_body_does_not_repeat_it() {
        // The row used to read `28.5% ━━━━━━━ 9,976 / 35,000 AFP · 28.5% of
        // limit`: one figure, twice, because the gauge and the body each printed
        // it. The gauge owns the percentage; the body prints the quota pair.
        let text = render_text(&report(), "/tmp/opencode.db", 10, true, DEFAULT_BAR_WIDTH);
        let weekly = text
            .lines()
            .find(|line| line.contains("Weekly"))
            .expect("a weekly row");
        assert!(!weekly.contains("of limit"), "no repeated share: {weekly}");
        assert!(weekly.contains("/ 35,000 AFP"), "the pair: {weekly}");
        assert!(
            weekly.contains("(est.)"),
            "still marked an estimate: {weekly}"
        );
    }

    #[test]
    fn the_machine_formats_are_not_coloured() {
        let rows = vec![Row {
            at_ms: 1_800_000_000_000,
            session: "ses_a".into(),
            provider: "agent-plan".into(),
            model: "deepseek-v4.1-flash".into(),
            input: 1_000,
            ..Default::default()
        }];
        let catalog = ark::catalog();
        for fmt in [Fmt::Json, Fmt::Csv] {
            let daily = bucket_text(
                &rows,
                &catalog,
                1_800_000_000_000,
                86_400_000,
                86_400_000,
                0,
                true,
                fmt,
            );
            assert!(!daily.contains('\u{1b}'), "{fmt:?} leaked colour: {daily}");
        }
        let report = report();
        let json = model_report(&report, None, Fmt::Json);
        assert!(!json.contains('\u{1b}'));
        assert!(json.contains("deepseek-v4.1-flash"));
        let csv = model_report(&report, None, Fmt::Csv);
        assert!(csv.starts_with("model,requests,tokens_in,tokens_out,cache_read,afp"));
    }
}
