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
use cmduse_core::{compact, duration, money, pct, share_of};

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

    /// The gauge alone, for a row whose dollar/cap pair already prints the
    /// percentage. Printing it in both places read as the same figure twice.
    fn gauge_only(&self, pct_used: f64) -> String {
        if !self.colour {
            return String::new();
        }
        format!(
            "{}{}{}",
            self.for_pct(pct_used),
            crate::render::gauge(pct_used, 100.0, self.bar_width),
            self.reset,
        )
    }
}

#[allow(clippy::too_many_arguments)]
/// One window row's inputs. The account's own meters and the local estimate both
/// go through this one builder, so the two branches cannot drift apart in which
/// fields a window row carries or in the order it carries them.
///
/// There is deliberately no account-wide pool here: Go grants limits per model,
/// and summing them read as a budget the console does not have — that is where
/// `$215` came from. A cap is only ever the model's published allowance (or the
/// time-weighted allowance for the month), carried in two roles: the published
/// cap the dollar/percent pair divides against, and the allowance pace and
/// pro-rata use. No percentage is ever read backwards into a dollar ceiling.
struct RowSpec<'a> {
    label: &'a str,
    /// This store's own totals for the window.
    used: &'a Totals,
    /// The window's reset instant and its length in seconds. `None` on the local
    /// estimate's rolling 5h/weekly windows: those are cut at `now - window`, so
    /// they have no boundary to measure an elapsed share against.
    reset: Option<(i64, u64)>,
    /// The published allowance for this window (model limit × the window's
    /// share). It is the only denominator printed beside the dollars.
    display_cap: Option<f64>,
    /// The allowance pace and the even-burn figure use — the weighted blend for
    /// the month, the published cap for the two throttles. `None` abstains.
    pace_cap: Option<f64>,
    /// The account's own verdict: a status it does not call `ok` rides beside
    /// the limit flag.
    status: Option<&'a str>,
    /// Whether an even-burn figure belongs on this row. True for the monthly
    /// window alone: that one is a budget, so "what even burn would have spent by
    /// now" is a fair comparison, where the 5-hour and weekly throttles would
    /// read the same number as a spend target.
    pro_rata: bool,
}

fn window_line(ink: &Ink, spec: &RowSpec<'_>, now_ms: i64) -> String {
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
    // cmduse's field order is importance order, so a clipped watch frame keeps
    // the actionable parts: limit flag, pace warning, elapsed share, then the
    // informational pro-rata figure. Duration (never rel_time) formats the ETA.
    let now_secs = (now_ms / 1000).max(0) as u64;
    let reset_at = spec.reset.map(|(at, _)| at as f64);
    let dur_secs = spec.reset.map(|(_, dur)| dur);
    let elapsed = dur_secs.and_then(|d| cmduse_core::elapsed_pct(reset_at, d, Some(now_secs)));
    // A dollar figure and a percentage only ever appear with the published cap
    // they divide against. There is no `spend / share` back-solve here: a blend
    // has no single denominator, so inferring one from a percentage invents a
    // ceiling exactly when the allowance moved.
    let display_cap = spec.display_cap.filter(|cap| *cap > 0.0);
    let pair = display_cap
        .map(|cap| format!(" of {} ({})", cap_money(cap), pct(spec.used.cost, cap)))
        .unwrap_or_default();
    let pace_cap = spec.pace_cap.filter(|cap| *cap > 0.0);
    let pace = pace_cap
        .and_then(|cap| {
            dur_secs.and_then(|d| {
                cmduse_core::pace_eta(reset_at, d, spec.used.cost, cap, now_secs)
                    .map(|secs| duration(secs as u64))
            })
        })
        .map(|eta| format!(" · {}on pace to hit cap in {eta}{}", ink.yellow, ink.reset))
        .unwrap_or_default();
    let thru = elapsed
        .map(|p| format!(" · {}window {p:.1}% elapsed{}", ink.dim, ink.reset))
        .unwrap_or_default();
    let by_now = match (spec.pro_rata, elapsed, pace_cap) {
        (true, Some(p), Some(cap)) => format!(
            " · {}{} by now{}",
            ink.dim,
            money(cap * p / 100.0),
            ink.reset
        ),
        _ => String::new(),
    };
    let label = spec.label;
    let flag = if display_cap.is_some_and(|cap| spec.used.cost >= cap) {
        format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
    } else if spec.status.is_some_and(|s| !s.eq_ignore_ascii_case("ok")) {
        format!(
            " {}{}{}{}",
            ink.red,
            spec.status.unwrap_or_default(),
            ink.reset,
            ""
        )
    } else {
        String::new()
    };
    // Composed in pieces: the pair and the pro-rata figure are conditional, and
    // one format string for both branches is a placeholder count waiting to drift.
    let body = format!(
        "{}{pair}{reset_text}{flag}{pace}{thru}{by_now}",
        money(spec.used.cost)
    );
    if ink.colour {
        // The gauge carries the cap-derived share. With no published cap there
        // is no bar: spend alone, never a gauge against an invented pool.
        let bar = match display_cap.and_then(|cap| share_of(spec.used.cost, cap)) {
            Some(p) => format!("{} ", ink.gauge_only(p)),
            None => String::new(),
        };
        format!(
            " {}{label:<8}{} {}{}{body}{}\n",
            ink.bold, ink.reset, bar, ink.dim, ink.reset,
        )
    } else {
        // The plain frame is the script-facing one: same field order,
        // no SGR (the Ink helpers are empty strings when colour is off).
        format!("  {label:<8} {body}\n")
    }
}

/// A whole-dollar cap reads as `$100`, not `$100.00` — the published allowance
/// is a round figure, and the pair `$69.87 of $100 (69.9%)` must show its cap as
/// the source printed it. Cents are still shown for a non-round cap.
fn cap_money(value: f64) -> String {
    if (value - value.round()).abs() < f64::EPSILON {
        format!("${}", value.round() as i64)
    } else {
        money(value)
    }
}

/// The model caps a window row divides against. Go grants limits per model, so
/// the account has no pool: the period's largest spender supplies its published
/// cap and the 20/50/100% window shares. Cap history is *not* needed for this —
/// today's limit is published in the catalogue in every run — it is only needed
/// for the blended headline. `None` on both sides when no model publishes a
/// cap: those rows show spend alone and abstain from pace.
fn window_caps(report: &Report, label: &str) -> (Option<f64>, Option<f64>) {
    let Some(limit) = report
        .models
        .first()
        .and_then(|model| model.limit.filter(|limit| *limit > 0.0))
    else {
        return (None, None);
    };
    let shares = &crate::ocuse::catalogue::catalog().go.window_share;
    let share = match label {
        "5-hour" => shares.five_hour,
        "Weekly" => shares.weekly,
        _ => shares.monthly,
    };
    let display = limit * share;
    let pace = if label == "Monthly" {
        report.cap_blend.weighted_allowance.unwrap_or(display)
    } else {
        display
    };
    (Some(display), Some(pace))
}

/// A percentage exactly as the endpoint published it.
///
/// The server sends integers (`"percent":53`), so `{:.1}` invented a decimal the
/// console never reports — and a tenth implies a precision its rounding does not
/// have. Local, computed percentages keep `pct`'s one decimal; this is only for
/// the values we are handed.
fn given_pct(value: f64) -> String {
    if (value - value.round()).abs() < f64::EPSILON {
        format!("{}", value.round() as i64)
    } else {
        format!("{:.1}", value)
    }
}

/// The account meter's own window boundary, when the endpoint gave one: its
/// reset instant together with the window's length, so the row can measure an
/// elapsed share and a pace against the server's clock rather than a guess.
fn meter_reset(meter: &crate::ocuse::api::Meter, dur_secs: Option<u64>) -> Option<(i64, u64)> {
    match (meter.reset_ms(), dur_secs) {
        (Some(at), Some(dur)) if dur > 0 => Some((at, dur)),
        _ => None,
    }
}

/// Is any of this model's windows over its share of the limit? Go meters per
/// model *and* per window, so being over the 5-hour cap counts like being over
/// the month. One verdict, shared with the watch loop's cap notification.
fn exceeded(model: &ModelUsage) -> bool {
    crate::ocuse::window::over_window(model).is_some()
}

/// The period's three biggest models, with their share of *all* use — money in
/// one column pair, tokens (input + output) in the other.
///
/// The share used to hang off each model row as a single trailing `%` of spend.
/// It moved here because a share only means something against the whole, and
/// the whole is what this block states; the row table below is per model
/// against its own limit, which is a different denominator. Tokens are counted
/// without cache reads: those run an order of magnitude larger and would make
/// every money share look like a rounding error.
fn top_models(ink: &Ink, report: &Report, count: usize, name_w: usize) -> String {
    let tokens = |model: &ModelUsage| model.month.input + model.month.output;
    let total_cost = report.month.cost;
    let total_tokens: u64 = report.models.iter().map(tokens).sum();
    if report.models.is_empty() || (total_cost <= 0.0 && total_tokens == 0) {
        return String::new();
    }
    // The label's padding keeps the money cells over their own columns however
    // wide the name field grew (`TOP N MODELS ` then the rest of the field).
    let lead = format!("TOP {count} MODELS");
    let label_w = name_w.saturating_sub(lead.chars().count() + 1);
    let mut out = format!(
        "\n{}{}{}{} {:<label_w$} {} {} {}\n",
        ink.bold,
        lead,
        ink.reset,
        ink.dim,
        "by period spend",
        ink.dim_on(format!("{:>10}", "MONEY")),
        ink.dim_on(format!("{:>8}", "SHARE")),
        ink.dim_on(format!("{:>10} {:>8}", "TOKENS", "SHARE")),
    );
    for model in report.models.iter().take(count) {
        let money_cell = ink.cyan_on(format!(
            "{:>10} {:>8}",
            money(model.month.cost),
            pct(model.month.cost, total_cost),
        ));
        out.push_str(&format!(
            "{:<name_w$} {money_cell} {:>10} {:>8}\n",
            model.id,
            compact(tokens(model)),
            pct(tokens(model) as f64, total_tokens as f64),
            name_w = name_w,
        ));
    }
    out
}

/// One row of the model table: limit, spend, share of that limit used, the two
/// rolling windows, and requests. The share of *period* spend moved to
/// `top_models`, so this row stays a per-model-vs-its-own-limit line.
fn model_row(ink: &Ink, model: &ModelUsage, name_w: usize) -> String {
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
    // the model so a clipped frame keeps it.
    let flag = if exceeded(model) {
        format!(" {}{}LIMIT EXCEEDED{}", ink.red, ink.bold, ink.reset)
    } else {
        String::new()
    };
    format!(
        "{:<name_w$}{flag} {:>7} {spent} {use_cell} {} {} {:>7}\n",
        model.id,
        limit,
        // Go windows are per model too: 5h = 20% of the limit, weekly = 50%.
        window_cell(ink, model, model.five_hour.cost, 0.20),
        window_cell(ink, model, model.weekly.cost, 0.50),
        compact(model.month.requests),
        name_w = name_w,
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
    let mut out = String::new();
    // Which local clients fed these rows, when it is not opencode alone: `pi` and
    // `dsh` spend the same Go allowance, so their store is named beside the path.
    let extra: Vec<&str> = report
        .clients
        .iter()
        .map(String::as_str)
        .filter(|client| *client != crate::stores::OPENCODE)
        .collect();
    let extra = if extra.is_empty() {
        String::new()
    } else {
        format!(" + {}", extra.join(", "))
    };
    out.push_str(&format!(
        "{}OpenCode usage{} — go + zen, from {}{}{}{}\n",
        ink.bold,
        ink.reset,
        ink.dim,
        shorten(db_path),
        extra,
        ink.reset,
    ));
    // cmduse prints `Success N%` from its account API; opencode's own store
    // records no per-request success/error signal, so there is no rate to read
    // here — omitted rather than synthesised (source-forced).
    let end = report
        .period_end_ms
        .map(|ms| format!(" · ends {}", date_of(ms / 86_400_000)))
        .unwrap_or_default();
    // The period line leads with the one share the whole dashboard is about:
    // how much of the allowance this period has used. When cap history sampled
    // a change, that is the time-weighted blend; a fresh install has no spans,
    // so the endpoint's own figure stands and says so. The blend is a share of
    // an average allowance, so no dollar cap is printed beside it — the
    // published cap and its own percentage get the labelled row below.
    let used = if report.account.is_none() {
        String::new()
    } else if report.cap_blend.percent_source == "blended" {
        format!(
            " · {} blended of limit",
            c(format!("{:.1}%", report.cap_blend.percent))
        )
    } else {
        format!(
            " · {}% of limit (server)",
            c(given_pct(report.cap_blend.server_percent))
        )
    };
    out.push_str(&format!(
        "period: {}{end} · {} requests · {} · {} in / {} out tokens{used}\n",
        report.period_label,
        c(compact(report.month.requests)),
        c(money(report.month.cost)),
        c(compact(report.month.input)),
        c(compact(report.month.output)),
    ));
    // Which catalogue the LIMIT column is measured against. A baked seed and a
    // cache read weeks ago must not look like a fresh fetch: the numbers moved
    // upstream while the file did not, and that is the defect this line exists
    // to make visible (see `ocuse::catalogue`).
    let provenance = crate::ocuse::catalogue::provenance();
    out.push_str(&format!(
        "{}catalogue: {}{}\n",
        ink.dim,
        provenance.describe(),
        ink.reset
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
                ink.dim_on(
                    "(account meters — what opencode.ai/console reports; the $ is this store's spend priced on the documented peak/off-peak schedule)"
                        .into()
                ),
            ));
            // Every field that is true stays on the row: this store's money, the
            // ceiling the server's own share implies, the share labelled beside
            // it, its reset instant, and the elapsed share measured against the
            // server's clock. No account-wide pool is invented here — summing the
            // per-model limits into one ceiling is where the old `$215` came from.
            let monthly_dur = report
                .period_end_ms
                .map(|end| ((end - report.since_ms) / 1000).max(0) as u64);
            let rows = [
                (
                    "5-hour",
                    &account.rolling,
                    &report.five_hour,
                    Some(crate::ocuse::window::FIVE_HOUR_SECS as u64),
                ),
                (
                    "Weekly",
                    &account.weekly,
                    &report.weekly,
                    Some(crate::ocuse::window::WEEKLY_SECS as u64),
                ),
                ("Monthly", &account.monthly, &report.month, monthly_dur),
            ];
            for (label, meter, used, dur_secs) in rows {
                let (display_cap, pace_cap) = window_caps(report, label);
                out.push_str(&window_line(
                    &ink,
                    &RowSpec {
                        label,
                        used,
                        reset: meter_reset(meter, dur_secs),
                        display_cap,
                        pace_cap,
                        status: Some(meter.status.as_str()),
                        // The monthly window is the budget; the two throttles
                        // above it would read a pro-rata figure as a target.
                        pro_rata: label == "Monthly",
                    },
                    report.now_ms,
                ));
            }
        }
        // No Go key, no network, or a key without the subscription: the store's
        // own spend, which says so. Limits are per model, so the rows carry
        // no pool to divide by -- spend alone, with the Monthly row's real
        // reset and elapsed share. They can disagree with the account.
        None if report.month.requests > 0 => {
            // Only the monthly period has a boundary of its own (`period_end_ms`).
            // The rolling 5h/weekly windows are cut at `now - window`, so they get
            // no reset, no elapsed share and no pace — the fabricated `now + window`
            // countdown that used to sit here moved on every frame.
            let monthly_dur = report
                .period_end_ms
                .map(|end| ((end - report.since_ms) / 1000).max(0) as u64);
            out.push_str(&format!(
                "\n{}GO{} {}\n",
                ink.bold,
                ink.reset,
                ink.dim_on(
                    "(estimated locally: limits are per model, so no pool: spend alone)".into()
                ),
            ));
            // Why the console's own numbers are missing, when there is a reason:
            // "estimated locally" alone cannot tell a missing key from an expired
            // one, and only the second is something a person can act on.
            if let Some(why) = &report.account_error {
                out.push_str(&format!("{}   usage API: {why}{}\n", ink.dim, ink.reset));
            }
            out.push_str(&window_line(
                &ink,
                &RowSpec {
                    label: "5-hour",
                    used: &report.five_hour,
                    reset: None,
                    display_cap: window_caps(report, "5-hour").0,
                    // No server reset: a rolling cut cannot sustain a pace claim.
                    pace_cap: None,
                    status: None,
                    pro_rata: false,
                },
                report.now_ms,
            ));
            out.push_str(&window_line(
                &ink,
                &RowSpec {
                    label: "Weekly",
                    used: &report.weekly,
                    reset: None,
                    display_cap: window_caps(report, "Weekly").0,
                    pace_cap: None,
                    status: None,
                    pro_rata: false,
                },
                report.now_ms,
            ));
            let (monthly_display, monthly_pace) = window_caps(report, "Monthly");
            out.push_str(&window_line(
                &ink,
                &RowSpec {
                    label: "Monthly",
                    used: &report.month,
                    reset: report.period_end_ms.zip(monthly_dur),
                    display_cap: monthly_display,
                    pace_cap: monthly_pace,
                    status: None,
                    // The published cap is real even without an account, so the
                    // monthly budget can still carry its even-burn figure.
                    pro_rata: true,
                },
                report.now_ms,
            ));
        }
        None => {}
    }

    // The two percentages each say what they are a share of. The blend above
    // answers "how used up am I"; this row answers "what would today's cap
    // say" — a different question, with the published cap printed beside the
    // dollars so the pair divides to exactly the percentage shown.
    let blend = &report.cap_blend;
    if let Some(cap) = blend.current_cap {
        let own = blend
            .current_cap_percent
            .map(|p| format!(" ({p:.1}%)"))
            .unwrap_or_default();
        out.push_str(&format!(
            "  {}today's limit{}  {} of {}{own} — current cap, not the period blend\n",
            ink.dim,
            ink.reset,
            c(money(blend.spend)),
            c(cap_money(cap)),
        ));
    }
    // A blend and a current-cap figure only disagree because the allowance
    // moved mid-period. Naming the move is what stops the two reading as a
    // contradiction.
    for change in &blend.changes {
        if report.models.iter().any(|model| model.id == change.model) {
            out.push_str(&format!(
                "  {}allowance raised {} → {} during this period{}\n",
                ink.dim,
                cap_money(change.from),
                cap_money(change.to),
                ink.reset
            ));
        }
    }
    if let Some(note) = &blend.note {
        out.push_str(&format!("  {}{note}{}\n", ink.dim, ink.reset));
    }

    // A model id wider than the field shoves its own row right, so the name
    // column takes the longest displayed id; 28 stays the floor (the width the
    // table was laid out for).
    let name_w = report
        .models
        .iter()
        .take(rows)
        .map(|model| model.id.chars().count())
        .max()
        .unwrap_or(0)
        .max(28);
    out.push_str(&top_models(&ink, report, 3, name_w));
    // The header carries the row's own widths so the two cannot drift: every
    // label is right-aligned in the field its cell occupies, and the name field
    // is left-aligned to the model id.
    out.push_str(&format!(
        "\n{}{:<name_w$} {:>7} {:>10} {:>7} {:>8} {:>8} {:>7}{}\n",
        ink.bold,
        "MODEL",
        "LIMIT",
        "SPENT",
        "USE",
        "5H",
        "WK",
        "REQ",
        ink.reset,
        name_w = name_w
    ));
    for model in report.models.iter().take(rows) {
        out.push_str(&model_row(&ink, model, name_w));
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
    // per model, so say whose they are: with an account answer they are cut at
    // the server's own window bounds (the same block and Monday-anchored week its
    // percentages describe), and only without one do they fall back to this
    // machine's rolling cuts.
    if report.account.is_some() {
        out.push_str(&format!(
            "{}\n",
            ink.dim_on(
                "5H/WK columns: this model's own spend inside the account's windows (the same cuts its percentages use)."
                    .into()
            )
        ));
    } else {
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
///   {catalog}                      where the limits came from: live, cache, builtin
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
    let cash = |v: f64| ink.cyan_on(money(v));
    // The account's own share outranks the local one wherever both exist: it is
    // what opencode.ai/console shows. Money tokens stay local either way — the
    // endpoint publishes shares and instants, not dollars. Without an account
    // there is no pool to divide by (Go grants limits per model), so the share
    // placeholders degrade to the money-less dash instead of a ratio against a
    // summed ceiling that reads as a budget the console does not have.
    let account = report.account.as_ref();
    let blend = &report.cap_blend;
    let month_share = if account.is_none() {
        "—".to_string()
    } else {
        pct(blend.percent, 100.0)
    };
    let share_of = |meter: Option<&crate::ocuse::api::Meter>| match meter {
        Some(meter) => pct(meter.percent, 100.0),
        None => "—".into(),
    };
    let meter_bar = |meter: Option<&crate::ocuse::api::Meter>| match meter {
        Some(meter) => crate::report_render::bar(meter.percent, bar_width, ascii, colours),
        None => String::new(),
    };
    let share_bar = |percent: f64| crate::report_render::bar(percent, bar_width, ascii, colours);
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
        "month_pct" => month_share.clone(),
        "month_bar" => {
            if account.is_some() {
                share_bar(blend.percent)
            } else {
                String::new()
            }
        }
        "five_hour" | "5h" => cash(report.five_hour.cost),
        "five_hour_pct" | "5h_pct" => share_of(account.map(|a| &a.rolling)),
        "five_hour_bar" | "5h_bar" => meter_bar(account.map(|a| &a.rolling)),
        "weekly" | "wk" => cash(report.weekly.cost),
        "weekly_pct" | "wk_pct" => share_of(account.map(|a| &a.weekly)),
        "weekly_bar" | "wk_bar" => meter_bar(account.map(|a| &a.weekly)),
        "models" => top_model(),
        "catalog" => crate::ocuse::catalogue::provenance().describe(),
        _ => String::new(),
    })
}

/// `ocuse statusline --json`: the same numbers the template resolves, in one
/// object — plan and period label, period/month spend, the two rolling windows,
/// and the top model. The `*Cap` keys are retired (always null): Go grants
/// limits per model, so no account-wide pool exists, and the summed ceiling
/// they carried read as a budget the console does not have. The key set is the
/// shared one from `report_render::STATUSLINE_KEYS`, aliases included.
pub fn statusline_json(report: &Report, plan_id: &str) -> String {
    serde_json::json!({
        "plan": plan_id,
        "source": "opencode.db",
        "period": report.period_label,
        "periodEnd": report.period_end_ms,
        "monthSpent": report.month.cost,
        "monthCap": serde_json::Value::Null,
        "fiveHourSpent": report.five_hour.cost,
        "fiveHourCap": serde_json::Value::Null,
        "weeklySpent": report.weekly.cost,
        "weeklyCap": serde_json::Value::Null,
        "model": report.models.first().map(|m| m.id.clone()),
        // The monthly share is the same figure the template and the dashboard
        // print: the local time-weighted blend when history sampled a cap move,
        // the endpoint's own number on a fresh install. `null` without an
        // account, matching the template's dash. The source field tells a
        // consumer which of the two it is reading.
        "month_pct": (report.account.is_some()).then_some(report.cap_blend.percent),
        "month_pct_source": report
            .account
            .as_ref()
            .map(|_| report.cap_blend.percent_source),
        // Which catalogue the per-model limits came from. Flat keys, matching
        // `oduse`'s statusline, so a consumer reads one name on both binaries.
        "catalogSource": crate::ocuse::catalogue::provenance().source.label(),
        "catalogAt": crate::ocuse::catalogue::provenance().at,
        "catalogAgeSecs": crate::ocuse::catalogue::provenance().age_secs,
        // The aliases keep their cmduse meaning; there is no credit pool here,
        // so the remainder is null rather than a fabricated zero.
        "fiveHourUsed": report.five_hour.cost,
        "weeklyUsed": report.weekly.cost,
        "monthlyRemaining": serde_json::Value::Null,
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
    let blend = &report.cap_blend;
    let monthly = |m: &crate::ocuse::api::Meter| {
        let mut base = meter(m);
        if let Some(obj) = base.as_object_mut() {
            // The headline stays a percent, but its meaning and provenance are
            // explicit. `serverPercent` is carried unchanged beside it and is
            // never overwritten by the local blend.
            obj.insert("percent".into(), serde_json::json!(blend.percent));
            obj.insert(
                "percentSource".into(),
                serde_json::json!(blend.percent_source),
            );
            obj.insert(
                "serverPercent".into(),
                serde_json::json!(blend.server_percent),
            );
            obj.insert("currentCap".into(), serde_json::json!(blend.current_cap));
            obj.insert(
                "currentCapPercent".into(),
                serde_json::json!(blend.current_cap_percent),
            );
            if let Some(note) = &blend.note {
                obj.insert("note".into(), serde_json::json!(note));
            }
        }
        base
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "source": "opencode.db",
        // Every local client the figures came from — opencode's own store plus
        // any of `dsh` / `pi` that ran this machine's traffic. Additive: a
        // consumer that predates it keeps reading `source`.
        "clients": &report.clients,
        "generatedAt": report.now_ms,
        "periodStart": report.since_ms,
        // Period bounds in epoch ms, the same units as cmduse's `-1 --json`
        // (`periodStartAt`/`periodEndAt`) — `periodStart` stays for the plugin's
        // existing read. `periodEndAt` is null when the period has no boundary
        // (`--window all`).
        "periodStartAt": report.since_ms,
        "periodEndAt": report.period_end_ms,
        // The family's display date (`cmduse` and `arkuse` both carry it);
        // `null` when the period has no boundary, as `periodEndAt` is.
        "periodEnd": report
            .period_end_ms
            .map(|ms| date_of(ms.div_euclid(86_400_000))),
        "periodInferred": report.month_inferred,
        // The period's own aggregate under the name `cmduse` and `arkuse` use
        // (`summary`); `totals` stays the existing shape, and its `month` member
        // is exactly this figure, so the two cannot disagree.
        "summary": totals(&report.month),
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
            "monthly": monthly(&a.monthly),
        })),
        // Why `account` is null, when that is worth saying — `HTTP 401
        // api_key_expired`, `no Go key`, a transport fault. `null` when the
        // endpoint answered, and for `--no-api`. Consumers otherwise show the
        // local estimate without being able to tell the three apart.
        "accountError": report.account_error,
        // Which catalogue priced the rows above: `{source: live|cache|builtin,
        // at, ageSecs, error}`. A consumer must be able to tell a fresh fetch
        // from the baked seed without knowing this binary's flags.
        "catalog": crate::ocuse::catalogue::provenance().json(),
        // Every allowance move sampled this run, in epoch ms. Empty on a fresh
        // install — the server's percentage is then the only blend available.
        "capChanges": &blend.changes,
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
/// Every plan the endpoint publishes is listed — Go, Go Plus and Go Teams today
/// — because they share one token price list but grant each model a different
/// monthly limit.
pub fn plans_text(colour: bool) -> String {
    let ink = Ink::new(colour);
    let catalog = crate::ocuse::zen::catalog();
    let mut out = format!(
        "{}OpenCode plans{} {}\n",
        ink.bold,
        ink.reset,
        ink.dim_on(format!(
            "(catalogue {})",
            crate::ocuse::catalogue::provenance().describe()
        )),
    );
    out.push_str(&format!(
        "{}windows (every plan): 5h {} · weekly {} · monthly {}{}\n",
        ink.dim,
        ink.cyan_on(format!("{:.1}%", catalog.go.window_share.five_hour * 100.0)),
        ink.cyan_on(format!("{:.1}%", catalog.go.window_share.weekly * 100.0)),
        ink.cyan_on(format!("{:.1}%", catalog.go.window_share.monthly * 100.0)),
        ink.reset,
    ));
    for plan in catalog.go.plans.values() {
        // The endpoint publishes allowances, not prices; one price per plan
        // comes from the docs article, and a plan it has not learned prints as
        // unknown rather than as a made-up $0.
        let price = if plan.price_usd > 0.0 {
            format!("${:.2}/month", plan.price_usd)
        } else {
            "price unknown".to_string()
        };
        out.push_str(&format!(
            "\n{}{}{} — {}\n",
            ink.bold,
            plan.label,
            ink.reset,
            ink.cyan_on(price),
        ));
        // Same widths as the rows below: limit 7, each rate 6, cache 8.
        out.push_str(&format!(
            "{}{:<28} {:>7} {:>6} {:>6} {:>8}{}\n",
            ink.bold, "MODEL", "LIMIT", "IN", "OUT", "CACHE", ink.reset
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
/// every plan (label, price, per-model monthly allowances), the shared window
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
        "catalog": crate::ocuse::catalogue::provenance().json(),
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
            "(plan {plan_id} · {granted}/{} granted · catalogue {})",
            catalog.go.models.len(),
            crate::ocuse::catalogue::provenance().label()
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
                // `sinceMs` is this binary's native form; `since` is the ISO spelling
                // cmduse and mpc use, so one name serves both readers.
                "sinceMs": report.since_ms,
                "since": cmduse_core::dates::iso_instant((report.since_ms.max(0) / 1000) as u64),
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
/// framing but for `Ink`'s colour. `rows` caps the `Table` form only (the newest
/// buckets survive); `Json`/`Csv` carry every bucket and are never coloured.
#[allow(clippy::too_many_arguments)]
pub fn bucket_text(
    rows: &[crate::ocuse::db::Row],
    now_ms: i64,
    lookback_ms: i64,
    size_ms: i64,
    tz_secs: i64,
    colour: bool,
    fmt: Fmt,
    cap: usize,
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
            let shown = window.len().min(cap);
            for (bucket, b) in window.iter().skip(window.len() - shown) {
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
            if window.len() > shown {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on(format!("… {} more", window.len() - shown))
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
                "sessions": keyed.clone(),
                // cmduse has always spelled this collection `projects`; both names
                // carry the same rows so a consumer reads either.
                "projects": keyed,
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
            for (id, (cost, requests, _, _, _, last, models)) in sessions.iter().take(limit) {
                let short = id.rsplit('_').next().unwrap_or(*id);
                out.push_str(&format!(
                    "{:<32} {:<11} {:>6} {} {:>6}\n",
                    short,
                    ink.dim_on(format!("{:<11}", date_of(last.div_euclid(86_400_000)))),
                    models.len(),
                    ink.cyan_on(format!("{:>9}", cmduse_core::money(*cost))),
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

/// `YYYY-MM-DD` for a Unix day number — `cmduse_core::dates::civil_from_days`,
/// so the three binaries cannot drift on the calendar.
pub fn date_of(day: i64) -> String {
    cmduse_core::dates::civil_from_days(day)
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
        crate::ocuse::window::build(&rows, zen::catalog(), zen::DEFAULT_PLAN, now, None, None)
    }

    /// The headline is the time-weighted 75%, not the 70% today's cap implies;
    /// the endpoint's agreeing 75 is corroboration, carried as `serverPercent`.
    #[test]
    fn the_current_cap_figure_is_shown_beside_the_blend_and_labelled() {
        let report = blended_report();
        assert_eq!(report.cap_blend.percent, 75.0, "the blend");
        assert_eq!(report.cap_blend.percent_source, "blended");
        assert_eq!(report.cap_blend.server_percent, 75.0, "kept unchanged");
        assert_eq!(report.cap_blend.current_cap, Some(100.0));
        assert_eq!(report.cap_blend.current_cap_percent, Some(70.0));

        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("75.0% blended of limit"), "{text}");
        assert!(
            text.contains("$70.00 of $100 (70.0%)"),
            "the current-cap pair, labelled: {text}"
        );
        assert!(text.contains("current cap, not the period blend"), "{text}");
        let json: serde_json::Value = serde_json::from_str(&render_json(&report)).unwrap();
        assert_eq!(json["account"]["monthly"]["percent"], 75.0);
        assert_eq!(json["account"]["monthly"]["percentSource"], "blended");
        assert_eq!(json["account"]["monthly"]["serverPercent"], 75.0);
        assert_eq!(json["account"]["monthly"]["currentCap"], 100.0);
        assert_eq!(json["account"]["monthly"]["currentCapPercent"], 70.0);
    }

    /// With no cap history the server's figure is the headline, but the gap
    /// against today's published cap is itself evidence the basis moved. The
    /// explanation names the model without inventing an unsampled old cap.
    #[test]
    fn a_server_cap_basis_that_moved_is_explained_without_history() {
        let report = server_only_report();
        assert_eq!(report.cap_blend.percent_source, "server");
        assert_eq!(report.cap_blend.percent, 76.0);
        assert_eq!(report.cap_blend.current_cap, Some(100.0));
        assert_eq!(report.cap_blend.current_cap_percent, Some(69.9));
        let note = report.cap_blend.note.as_deref().expect("an explanation");
        assert!(
            note.contains("allowance changed during this period"),
            "{note}"
        );
        assert!(note.contains("76"), "{note}");
        assert!(note.contains("69.9"), "{note}");
        assert!(
            note.contains("DeepSeek V4.1 Flash"),
            "the single big spender: {note}"
        );
        assert!(!note.contains("80"), "no invented old cap: {note}");
        assert!(!note.contains("→"), "no invented span: {note}");
        assert!(report.cap_blend.changes.is_empty());

        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("76% of limit (server)"), "{text}");
        assert!(text.contains("$69.87 of $100 (69.9%)"), "{text}");
        assert!(
            text.contains("the allowance changed during this period (DeepSeek V4.1 Flash"),
            "{text}"
        );
        assert!(
            text.contains("the server meters 76%, today's cap implies 69.9%"),
            "{text}"
        );
        assert!(
            !text.contains("allowance raised"),
            "no sampled move: {text}"
        );
        let json: serde_json::Value = serde_json::from_str(&render_json(&report)).unwrap();
        assert_eq!(json["account"]["monthly"]["percentSource"], "server");
        assert_eq!(json["account"]["monthly"]["currentCap"], 100.0);
        assert_eq!(json["capChanges"].as_array().unwrap().len(), 0);
        assert!(json["account"]["monthly"]["note"]
            .as_str()
            .unwrap()
            .contains("allowance changed"));
    }

    /// `statusline --json`'s `month_pct` is the very same figure the template,
    /// the dashboard and the main JSON print: the blend when history sampled a
    /// change, the server's number otherwise, and null without an account.
    #[test]
    fn statusline_month_pct_follows_the_blend() {
        let blended: serde_json::Value =
            serde_json::from_str(&statusline_json(&blended_report(), "go")).unwrap();
        assert_eq!(blended["month_pct"], 75.0);
        assert_eq!(blended["month_pct_source"], "blended");
        crate::report_render::assert_statusline_keys(&blended);

        let server: serde_json::Value =
            serde_json::from_str(&statusline_json(&server_only_report(), "go")).unwrap();
        assert_eq!(server["month_pct"], 76.0);
        assert_eq!(server["month_pct_source"], "server");
        crate::report_render::assert_statusline_keys(&server);

        let no_account: serde_json::Value =
            serde_json::from_str(&statusline_json(&report(), "go")).unwrap();
        assert_eq!(no_account["month_pct"], serde_json::Value::Null);
        crate::report_render::assert_statusline_keys(&no_account);
    }

    /// The two figures disagree only because the allowance moved; the output
    /// names the move so they do not read as a contradiction.
    #[test]
    fn a_mid_period_cap_rise_is_named_in_the_output() {
        let text = render_text(
            &blended_report(),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        assert!(text.contains("raised"), "{text}");
        assert!(text.contains("80"), "{text}");
        assert!(text.contains("100"), "{text}");
        assert!(
            text.contains("allowance raised $80 → $100 during this period"),
            "{text}"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_json(&blended_report())).unwrap()
                ["capChanges"]
                .as_array()
                .unwrap()
                .len(),
            1,
            "the move is in JSON too"
        );
    }

    /// No dollar/percent pair may multiply back to a cap the source never
    /// published. Every published pair divides to its printed percentage, and
    /// there is no `spend (share)` form anywhere in the frame.
    #[test]
    fn a_dollar_and_percent_never_imply_a_cap() {
        let text = render_text(
            &blended_report(),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        assert!(text.contains("$70.00 of $100 (70.0%)"), "{text}");
        // $70 / $100 = 70%, so the pair's own arithmetic is self-contained.
        // The blended headline deliberately prints no dollar beside it, so no
        // reader can multiply $70 by 75% back into a $93.33 "cap".
        assert!(!text.contains("$70.00 (75"), "{text}");
        // The blended headline stands alone: no dollar denominator is printed
        // beside it, because a blend has no single cap to print.
        let headline = text
            .lines()
            .find(|line| line.contains("blended of limit"))
            .expect("the headline");
        let share_part = headline.split("tokens").nth(1).unwrap_or(headline);
        assert!(!share_part.contains('$'), "headline share: {share_part}");
        assert!(!text.contains("implied"), "{text}");
        // The model table keeps its own published cap and its own USE pair.
        assert!(text.contains("$100"), "{text}");
    }

    #[test]
    fn text_shows_the_model_against_its_limit() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("glm-5.3-flash"), "{text}");
        assert!(text.contains("$60"), "the model's monthly limit: {text}");
        assert!(
            text.contains("50.0%"),
            "the model table keeps its own USE: {text}"
        );
    }

    /// `pi` and `dsh` spend the same allowance, so the header names them rather
    /// than printing a total that disagrees with opencode's own store alone.
    #[test]
    fn the_header_names_a_client_beside_opencode() {
        let now = 1_800_000_000_000;
        let rows = vec![
            Row {
                client: "opencode",
                at_ms: now - 60_000,
                provider: "opencode-go".into(),
                model: "glm-5.3-flash".into(),
                cost_usd: 1.0,
                ..Default::default()
            },
            Row {
                client: "pi",
                at_ms: now - 60_000,
                provider: "opencode-go".into(),
                model: "glm-5.3-flash".into(),
                cost_usd: 1.0,
                ..Default::default()
            },
        ];
        let report =
            crate::ocuse::window::build(&rows, zen::catalog(), zen::DEFAULT_PLAN, now, None, None);
        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(
            text.contains("/tmp/opencode.db + pi"),
            "the header names the extra client: {text}"
        );
    }

    /// The right edge (1-based, inclusive) of every whitespace-separated cell.
    fn cell_ends(line: &str) -> Vec<usize> {
        let mut ends = Vec::new();
        let mut cursor = 0;
        for cell in line.split_whitespace() {
            let start = line[cursor..].find(cell).expect("cell in line") + cursor;
            cursor = start + cell.len();
            ends.push(cursor);
        }
        ends
    }

    /// The header labels sit in the columns their cells do: every numeric column
    /// is right-aligned, so its label must end where the value ends.
    #[test]
    fn the_model_table_header_aligns_with_its_rows() {
        let now = 1_800_000_000_000;
        // $5 of a $60 limit: no LIMIT EXCEEDED flag, which shifts a row on
        // purpose.
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 5.0,
            ..Default::default()
        }];
        let report =
            crate::ocuse::window::build(&rows, zen::catalog(), zen::DEFAULT_PLAN, now, None, None);
        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let mut lines = text.lines().skip_while(|line| !line.starts_with("MODEL "));
        let header = lines.next().expect("the table header");
        let row = lines
            .find(|line| line.starts_with("glm-5.3-flash"))
            .expect("the model row");
        let header_ends = cell_ends(header);
        assert_eq!(
            header_ends[1..],
            cell_ends(row)[1..header_ends.len()],
            "header columns must end where their cells do:\n{header}\n{row}"
        );
    }

    /// The catalogue table is the second literal header: same rule, same check.
    #[test]
    fn the_models_table_header_aligns_with_its_rows() {
        let text = models_text(zen::DEFAULT_PLAN, false, false);
        let mut lines = text.lines().skip_while(|line| !line.starts_with("MODEL "));
        let header = lines.next().expect("the table header");
        // A free row prints `—` and a >28-char id overflows the name field, so
        // pick a granted model whose id leaves the name column intact.
        let row = lines
            .find(|line| line.starts_with("DeepSeek V4.1 Flash"))
            .expect("the model row");
        let header_ends = cell_ends(header);
        let row_ends = cell_ends(row);
        // MODEL and ID are left-aligned (and a display name may hold spaces), so
        // only the last five — the three rates, the limit and GRANTED — compare
        // on their right edge.
        assert_eq!(
            &header_ends[header_ends.len() - 5..],
            &row_ends[row_ends.len() - 5..],
            "header columns must end where their cells do:\n{header}\n{row}"
        );
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
    /// the countdowns render rather than clamp to zero. The period bounds mirror
    /// what `cli.rs` derives from the monthly reset (`prev_month`), so the
    /// Monthly row carries the same elapsed share and pro-rata figure a live
    /// dashboard shows.
    fn report_with_account() -> Report {
        let mut report = report();
        report.account = Some(crate::ocuse::api::Usage {
            rolling: meter("ok", 5.0, "2027-01-15T12:31:00.000Z"),
            weekly: meter("ok", 59.0, "2027-01-18T00:00:00.000Z"),
            monthly: meter("ok", 29.0, "2027-02-15T08:00:00.000Z"),
        });
        // `build` sees no account when this fixture attaches one afterwards,
        // so seed the same server percentage it would have carried.
        report.cap_blend = crate::ocuse::window::CapBlend::from_server(29.0);
        report.period_end_ms = Some(1_802_678_400_000); // 2027-02-15T08:00:00Z
        report.since_ms = crate::ocuse::window::prev_month(1_802_678_400_000);
        report
    }

    /// A 30-day window with a third elapsed and $70 of DeepSeek spend, whose
    /// cap rose $80 → $100 at the ten-day mark. The server's own figure (75) is
    /// the blend that actually happened; the current cap alone would print
    /// 70 and be wrong as a measure of how used up the account is.
    fn blended_report() -> Report {
        let now = 1_800_000_000_000i64; // 2027-01-15T08:00:00Z
        let since = now - 30 * 86_400_000; // 30 days elapsed, the whole window
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "deepseek-v4.1-flash".into(),
            cost_usd: 70.0,
            ..Default::default()
        }];
        let mut report = crate::ocuse::window::build(
            &rows,
            zen::catalog(),
            zen::DEFAULT_PLAN,
            now,
            Some(since),
            None,
        );
        // `build` does not attach the account itself (the CLI does), so set the
        // meter and its server percentage the same way the CLI would.
        let reset = cmduse_core::dates::iso_instant((now / 1000) as u64);
        report.account = Some(crate::ocuse::api::Usage {
            rolling: meter("ok", 5.0, "2027-01-15T12:31:00.000Z"),
            weekly: meter("ok", 59.0, "2027-01-18T00:00:00.000Z"),
            monthly: meter("ok", 75.0, &reset),
        });
        report.cap_blend = crate::ocuse::window::CapBlend::from_server(75.0);
        report.period_end_ms = Some(now);
        let rise = since + 10 * 86_400_000;
        crate::ocuse::window::apply_cap_history(
            &mut report,
            &[crate::ocuse::window::CapChange {
                model: "deepseek-v4.1-flash".into(),
                from: 80.0,
                to: 100.0,
                at: rise,
            }],
        );
        report
    }

    /// The real fresh-install case: the account answered 76%, the catalogue
    /// publishes $100 for DeepSeek V4.1 Flash and $70 was spent against it
    /// (69.9%), but no cap history has ever been sampled.
    fn server_only_report() -> Report {
        let now = 1_800_000_000_000i64;
        let since = now - 30 * 86_400_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "deepseek-v4.1-flash".into(),
            cost_usd: 69.873,
            ..Default::default()
        }];
        let mut report = crate::ocuse::window::build(
            &rows,
            zen::catalog(),
            zen::DEFAULT_PLAN,
            now,
            Some(since),
            None,
        );
        report.account = Some(crate::ocuse::api::Usage {
            rolling: meter("ok", 1.0, "2027-01-15T12:31:00.000Z"),
            weekly: meter("ok", 3.0, "2027-01-18T00:00:00.000Z"),
            monthly: meter("ok", 76.0, "2027-01-15T08:00:00.000Z"),
        });
        report.cap_blend = crate::ocuse::window::CapBlend::from_server(76.0);
        report.period_end_ms = Some(now);
        crate::ocuse::window::apply_cap_history(&mut report, &[]);
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
        // The headline is the server's blend on a fresh install, labelled so it
        // is never mistaken for a locally computed one. The window rows carry
        // the *published* model cap beside this store's spend, never a ceiling
        // inferred from the server's percentage.
        assert!(text.contains("29% of limit (server)"), "{text}");
        assert!(text.contains("account meters"), "{text}");
        assert!(
            text.contains("resets 4h 31m"),
            "the 5h block's own end: {text}"
        );
        // glm-5.3-flash publishes $60: 5h = $12, weekly = $30, monthly = $60.
        assert!(text.contains("$30.00 of $12 (250.0%)"), "{text}");
        assert!(text.contains("$30.00 of $60 (50.0%)"), "{text}");
        assert!(!text.contains("5% of limit"), "{text}");
        // The monthly window measures against the period bounds, like cmduse's:
        // an elapsed share, the server's reset, and the even-burn figure — which
        // only the budget window gets, because the two throttles above it would
        // read it as a spend target.
        assert!(text.contains("elapsed"), "{text}");
        assert_eq!(text.matches("by now").count(), 1, "{text}");
        // …and the per-model columns are named as the same cuts, not a second
        // measurement of a different window.
        assert!(text.contains("the same cuts its percentages use"), "{text}");
    }

    /// The colour frame puts the share on the gauge; the plain frame puts it
    /// in the dollar/cap pair. Neither prints a second, server-derived share
    /// that would multiply back to an unpublished ceiling.
    #[test]
    fn the_gauge_carries_the_share_and_the_body_does_not_repeat_it() {
        let colour = render_text(
            &report_with_account(),
            "/tmp/opencode.db",
            10,
            true,
            DEFAULT_BAR_WIDTH,
        );
        let five = colour
            .lines()
            .find(|line| line.contains("5-hour"))
            .expect("a 5-hour row");
        // The gauge bar is there, but the body does not print a second share.
        assert!(five.contains("━"), "the gauge: {five}");
        assert_eq!(
            five.matches("250.0%").count(),
            1,
            "the share is printed once, in the dollar/cap pair: {five}"
        );
        let plain = render_text(
            &report_with_account(),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        assert!(plain.contains("$30.00 of $12 (250.0%)"), "{plain}");
    }

    /// Pace uses the published/weighted allowance, never a cap inferred from a
    /// percentage. With no allowance it abstains: no model with a published
    /// limit means no ceiling, no pace line, no pro-rata figure.
    #[test]
    fn pace_uses_the_weighted_allowance_and_abstains_without_one() {
        let now = 1_800_000_000_000i64;
        let free = Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "beam-free".into(), // a free model, no published limit
            cost_usd: 5.0,
            ..Default::default()
        };
        let mut no_cap = crate::ocuse::window::build(
            &[free],
            zen::catalog(),
            zen::DEFAULT_PLAN,
            now,
            Some(now - 30 * 86_400_000),
            None,
        );
        no_cap.account = Some(crate::ocuse::api::Usage {
            rolling: meter("ok", 5.0, "2027-01-15T09:00:00.000Z"),
            weekly: meter("ok", 59.0, "2027-01-18T00:00:00.000Z"),
            monthly: meter("ok", 29.0, "2027-02-15T08:00:00.000Z"),
        });
        no_cap.cap_blend = crate::ocuse::window::CapBlend::from_server(29.0);
        no_cap.period_end_ms = Some(now + 30 * 86_400_000);
        let text = render_text(&no_cap, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(!text.contains("on pace to hit cap"), "{text}");
        assert!(!text.contains("by now"), "{text}");

        // With a cap history the monthly pace/pro-rata uses the weighted
        // allowance, not today's limit: the $93.33 blend makes the $70 spend
        // 75%, whereas today's $100 would read 70%.
        let report = blended_report();
        assert_eq!(report.cap_blend.weighted_allowance, Some(280.0 / 3.0));
        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("by now"), "{text}");
        let json: serde_json::Value = serde_json::from_str(&render_json(&report)).unwrap();
        assert_eq!(json["account"]["monthly"]["percent"], 75.0);
    }

    #[test]
    fn a_reachable_cap_gets_the_pace_line() {
        let now = 1_800_000_000_000i64;
        let rows = vec![Row {
            at_ms: now - 3_600_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            cost_usd: 10.0,
            ..Default::default()
        }];
        let mut report = crate::ocuse::window::build(
            &rows,
            zen::catalog(),
            zen::DEFAULT_PLAN,
            now,
            Some(now - 30 * 86_400_000),
            None,
        );
        report.account = Some(crate::ocuse::api::Usage {
            rolling: meter("ok", 5.0, "2027-01-15T09:00:00.000Z"),
            weekly: meter("ok", 59.0, "2027-01-18T00:00:00.000Z"),
            monthly: meter("ok", 29.0, "2027-02-15T08:00:00.000Z"),
        });
        report.cap_blend = crate::ocuse::window::CapBlend::from_server(29.0);
        report.period_end_ms = Some(now + 30 * 86_400_000);
        // $10 spent inside a 5-hour block four hours in, against the model's
        // published $12 cap: the $2 left is reached in 48m, inside the 1h left.
        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("on pace to hit cap in"), "{text}");
    }

    #[test]
    fn without_an_account_the_rows_say_they_are_local() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(text.contains("estimated locally"), "{text}");
        assert!(text.contains("no pool"), "no aggregate ceiling: {text}");
        // The rows carry the model's published cap, not a pool inferred from a
        // percentage, and no countdown without a boundary.
        assert!(text.contains("$30.00 of $60 (50.0%)"), "{text}");
        assert!(!text.contains("resets"), "{text}");
        assert!(!text.contains("elapsed"), "{text}");
        // Nothing claims to be the account's own view.
        assert!(!text.contains("account meters"), "{text}");
        assert!(
            !text.contains("the same cuts its percentages use"),
            "{text}"
        );
        // Without an answer the columns keep saying they are this machine's own
        // rolling cuts, since there is no server window to align them to.
        assert!(text.contains("local, not the account's windows"), "{text}");
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
        // `summary` is the period's own aggregate under the name cmduse and
        // arkuse use; it is the same object as `totals.month`, so the two keys
        // can never disagree.
        assert_eq!(parsed["summary"], parsed["totals"]["month"]);
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
                bucket_text(
                    &rows,
                    now,
                    7 * 86_400_000,
                    86_400_000,
                    0,
                    false,
                    Fmt::Table,
                    usize::MAX,
                ),
                bucket_text(
                    &rows,
                    now,
                    7 * 86_400_000,
                    86_400_000,
                    0,
                    true,
                    Fmt::Table,
                    usize::MAX,
                ),
            ),
            (
                "bucket_text/hour",
                bucket_text(
                    &rows,
                    now,
                    3_600_000,
                    3_600_000,
                    0,
                    false,
                    Fmt::Table,
                    usize::MAX,
                ),
                bucket_text(
                    &rows,
                    now,
                    3_600_000,
                    3_600_000,
                    0,
                    true,
                    Fmt::Table,
                    usize::MAX,
                ),
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
                bucket_text(
                    &rows,
                    now,
                    7 * 86_400_000,
                    86_400_000,
                    0,
                    false,
                    Fmt::Csv,
                    usize::MAX,
                ),
                bucket_text(
                    &rows,
                    now,
                    7 * 86_400_000,
                    86_400_000,
                    0,
                    true,
                    Fmt::Csv,
                    usize::MAX,
                ),
            ),
            (
                "bucket_text/hour json",
                bucket_text(
                    &rows,
                    now,
                    3_600_000,
                    3_600_000,
                    0,
                    false,
                    Fmt::Json,
                    usize::MAX,
                ),
                bucket_text(
                    &rows,
                    now,
                    3_600_000,
                    3_600_000,
                    0,
                    true,
                    Fmt::Json,
                    usize::MAX,
                ),
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
    fn session_rows_cap_the_table_and_never_the_machine_formats() {
        // `--rows` is a display cap (the CLI passes it straight in). JSON/CSV
        // must keep every session: a consumer that reads a short report as the
        // whole window is worse than a long table.
        let now = 1_800_000_000_000;
        let rows: Vec<Row> = (0..25)
            .map(|i| Row {
                at_ms: now - i as i64 * 60_000,
                provider: "opencode-go".into(),
                model: "glm-5.3-flash".into(),
                session: format!("ses_{i:02}"),
                cost_usd: 0.1,
                ..Default::default()
            })
            .collect();
        let table = session_text(&rows, 2, false, Fmt::Table);
        assert!(table.contains("… 23 more"), "{table}");
        assert_eq!(
            table.lines().count(),
            4,
            "header + 2 rows + the tail: {table}"
        );
        let json: serde_json::Value =
            serde_json::from_str(&session_text(&rows, 2, false, Fmt::Json)).unwrap();
        assert_eq!(json["sessions"].as_object().unwrap().len(), 25);
        let csv = session_text(&rows, 2, false, Fmt::Csv);
        assert_eq!(csv.lines().count(), 26, "header + every session: {csv}");
    }

    #[test]
    fn bucket_rows_cap_the_table_and_never_the_machine_formats() {
        // `daily`/`hourly` share this renderer: the newest buckets survive a cap,
        // the tail counts what was withheld, and JSON/CSV keep every bucket.
        let now = 1_800_000_000_000;
        let rows: Vec<Row> = (0..4)
            .map(|i| Row {
                at_ms: now - i as i64 * 86_400_000,
                provider: "opencode-go".into(),
                model: "glm-5.3-flash".into(),
                session: format!("ses_{i}"),
                cost_usd: 0.1,
                ..Default::default()
            })
            .collect();
        let table = bucket_text(
            &rows,
            now,
            7 * 86_400_000,
            86_400_000,
            0,
            false,
            Fmt::Table,
            2,
        );
        assert!(table.contains("… 2 more"), "{table}");
        assert_eq!(table.lines().count(), 4, "header + 2 + tail: {table}");
        let full = bucket_text(
            &rows,
            now,
            7 * 86_400_000,
            86_400_000,
            0,
            false,
            Fmt::Table,
            usize::MAX,
        );
        assert!(!full.contains("more"), "nothing trimmed: {full}");
        let json: serde_json::Value = serde_json::from_str(&bucket_text(
            &rows,
            now,
            7 * 86_400_000,
            86_400_000,
            0,
            false,
            Fmt::Json,
            2,
        ))
        .unwrap();
        assert_eq!(json["days"].as_object().unwrap().len(), 4);
        let csv = bucket_text(
            &rows,
            now,
            7 * 86_400_000,
            86_400_000,
            0,
            false,
            Fmt::Csv,
            2,
        );
        assert_eq!(csv.lines().count(), 6, "header + 4 rows + total: {csv}");
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
        let csv = bucket_text(
            &rows,
            now,
            7 * 86_400_000,
            86_400_000,
            0,
            false,
            Fmt::Csv,
            usize::MAX,
        );
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
            usize::MAX,
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
    fn catalogue_json_carries_every_plan_and_windows() {
        let json: serde_json::Value = serde_json::from_str(&plans_json()).unwrap();
        assert_eq!(json["windows"]["fiveHour"], 0.2);
        assert_eq!(json["windows"]["monthly"], 1.0);
        assert_eq!(json["plans"][0]["id"], "go");
        assert_eq!(json["plans"][0]["allowanceByModel"]["glm-5.3-flash"], 60.0);
        assert_eq!(json["plans"][1]["priceUsd"], 40.0);
        assert_eq!(json["plans"][2]["id"], "go-teams");
        assert_eq!(json["plans"][2]["priceUsd"], 20.0);
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
        // No account-wide pool exists (limits are per model), so the cap keys
        // stay null; the per-model limits live on the models array.
        assert_eq!(json["monthCap"], serde_json::Value::Null);
        assert_eq!(json["fiveHourCap"], serde_json::Value::Null);
        assert_eq!(json["weeklyCap"], serde_json::Value::Null);
        assert_eq!(json["model"], "glm-5.3-flash");
    }

    #[test]
    fn ocuse_statusline_json_carries_the_shared_keys() {
        let json: serde_json::Value =
            serde_json::from_str(&statusline_json(&report(), "go")).unwrap();
        crate::report_render::assert_statusline_keys(&json);
    }

    #[test]
    fn plain_frames_carry_no_escapes() {
        let text = render_text(&report(), "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        assert!(
            !text.contains('\x1b'),
            "piped output must stay plain: {text}"
        );
        // The header rows carry no gauge and no share without an account; the
        // plain frame keeps the money the colour frame shows.
        assert!(text.contains("$30.00"), "{text}");
    }

    /// The monthly row is the only one with a real period end, so it alone gains
    /// the reset and the elapsed share; the rolling windows have no boundary
    /// and must not invent one. Nothing divides by a pool: limits are per model.
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

        for label in ["5-hour", "Weekly"] {
            let row = text
                .lines()
                .find(|line| line.trim_start().starts_with(label))
                .unwrap_or_else(|| panic!("the {label} row"));
            assert!(!row.contains("elapsed"), "{label} has no boundary: {row}");
            assert!(!row.contains("resets"), "{label} has no boundary: {row}");
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
        // The TOP 3 block above the table also opens with the model id, so the
        // row under test is the first one *after* the table's own header.
        let row = plain
            .lines()
            .skip_while(|line| !line.starts_with("MODEL "))
            .find(|line| line.starts_with("glm-5.3-flash"))
            .expect("the model row");
        assert!(row.contains("LIMIT EXCEEDED"), "{row}");
        // The share of period spend moved to the TOP 3 block, so a model row
        // ends on its own request count and carries no trailing `%`.
        assert!(!row.trim_end().ends_with('%'), "no trailing share: {row}");
        assert!(row.trim_end().ends_with(char::is_numeric), "{row}");
    }

    /// The period line states the one share the whole dashboard is about — the
    /// server's own monthly percentage — and states nothing when no account
    /// answered (Go's limits are per model; there is no period-wide pool).
    #[test]
    fn period_line_carries_the_account_monthly_share() {
        let with = render_text(
            &report_with_account(),
            "/tmp/opencode.db",
            10,
            false,
            DEFAULT_BAR_WIDTH,
        );
        let header = with
            .lines()
            .find(|line| line.starts_with("period:"))
            .expect("the period line");
        assert!(header.contains("% of limit"), "{header}");
        assert!(
            header.contains("29%"),
            "the fixture's monthly meter: {header}"
        );

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

    /// The TOP 3 block splits the period between money and tokens, and both
    /// shares are of the whole — not of the model's own limit.
    #[test]
    fn top_models_state_their_share_of_money_and_tokens() {
        // Tokens, so both columns have a real denominator: the store prices a
        // row from its tokens, and the shared fixture's $30 is a recorded
        // figure with no tokens behind it.
        let now = 1_800_000_000_000;
        let rows = vec![Row {
            at_ms: now - 60_000,
            provider: "opencode-go".into(),
            model: "glm-5.3-flash".into(),
            input: 1_200_000,
            output: 400_000,
            ..Default::default()
        }];
        let report =
            crate::ocuse::window::build(&rows, zen::catalog(), zen::DEFAULT_PLAN, now, None, None);
        let text = render_text(&report, "/tmp/opencode.db", 10, false, DEFAULT_BAR_WIDTH);
        let block = text
            .lines()
            .skip_while(|line| !line.starts_with("TOP 3 MODELS"))
            .take_while(|line| !line.starts_with("MODEL "))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(block.contains("glm-5.3-flash"), "{block}");
        assert!(
            block.contains("MONEY") && block.contains("TOKENS"),
            "{block}"
        );
        // One model takes the whole period, so both shares are 100%.
        assert_eq!(block.matches("100.0%").count(), 2, "{block}");
        // A single-model period renders no share on the row table above it.
        assert!(!text.contains("of period spend"), "{text}");
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
            crate::ocuse::window::build(&rows, zen::catalog(), zen::DEFAULT_PLAN, now, None, None);
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
            zen::catalog(),
            zen::DEFAULT_PLAN,
            1_800_000_000_000,
            None,
            None,
        );
        assert!(!model_text(&empty, "glm-5.3-flash", false).contains("share"));
    }

    #[test]
    fn colour_frames_get_the_palette_and_a_gauge() {
        // Gauge bars exist only where a share gates: the account's own rows.
        // The local estimate divides by no pool, so its rows carry no bar —
        // spend alone, never a gauge against a fiction. Palette assertions live
        // on the model table, whose per-model limits are real.
        let text = render_text(
            &report_with_account(),
            "/tmp/opencode.db",
            10,
            true,
            DEFAULT_BAR_WIDTH,
        );
        assert!(text.contains(crate::render::BOLD), "{text}");
        assert!(text.contains(crate::render::CYAN), "{text}");
        assert!(
            text.contains(crate::render::GREEN),
            "the 50% USE cell is green: {text}"
        );
        assert!(
            text.contains('━') && text.contains('╱'),
            "the account share's gauge bar: {text}"
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
        // without an account there is no pool to divide by (limits are per
        // model), so the share placeholders degrade to the dash; the account's
        // own shares resolve when it answers (pinned by the account test above)
        assert_eq!(line("{month_pct}"), "—");
        assert_eq!(line("{month_bar}"), "");
        assert_eq!(line("{five_hour_pct}"), "—");
        assert_eq!(line("{weekly_pct}"), "—");

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

    /// A period with no spend resolves no shares either way, so the pct
    /// placeholders degrade to the money-less dash instead of NaN.
    #[test]
    fn statusline_without_caps_degrades_gracefully() {
        let empty = crate::ocuse::window::build(
            &[],
            zen::catalog(),
            zen::DEFAULT_PLAN,
            1_800_000_000_000,
            None,
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

    #[test]
    fn report_json_envelopes_are_the_shared_contract() {
        // Same constants cmduse asserts: one envelope per report on all three.
        use crate::report_render::{
            REPORT_DAILY_KEYS, REPORT_HOURLY_KEYS, REPORT_MODEL_KEYS, REPORT_SESSION_KEYS,
        };
        let keys = |body: String| -> Vec<String> {
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();
            v.as_object().unwrap().keys().cloned().collect()
        };
        let now = 1_800_000_000_000;
        let day = 86_400_000;
        assert_eq!(
            keys(bucket_text(
                &[],
                now,
                2 * day,
                day,
                0,
                false,
                Fmt::Json,
                usize::MAX
            )),
            REPORT_DAILY_KEYS.to_vec()
        );
        assert_eq!(
            keys(bucket_text(
                &[],
                now,
                2 * 3_600_000,
                3_600_000,
                0,
                false,
                Fmt::Json,
                usize::MAX
            )),
            REPORT_HOURLY_KEYS.to_vec()
        );
        assert_eq!(
            keys(model_report(&report(), None, Fmt::Json)),
            REPORT_MODEL_KEYS.to_vec()
        );
        assert_eq!(
            keys(session_text(&[], 5, false, Fmt::Json)),
            REPORT_SESSION_KEYS.to_vec()
        );
    }
}
