// The live frame: the default command's loop.
//
// Same contract as the other three binaries — the frame's last line carries no
// newline, so the cursor parks there and the countdown rewrites that one line
// each second instead of repainting the whole frame. One difference the source
// forces: the store is re-read every tick, so a turn finishing in the desktop app
// shows up on the next refresh without a restart.
use crate::oduse::od::{Catalog, Plan};
use crate::oduse::wallet::{self, Wallet};
use crate::oduse::{db, period, render, window};
use std::io::Write;

pub struct Loop<'a> {
    pub db_path: &'a str,
    pub catalog: &'a Catalog,
    pub plan: &'a Plan,
    pub plan_id: &'a str,
    pub rows: usize,
    pub colour: bool,
    pub bar_width: usize,
    pub interval: u64,
    pub burst_on: bool,
    pub burst_cap: usize,
    pub notify_on_cap: bool,
    pub update: Option<String>,
    /// The read cutoff for the report (an explicit `--since`, else `--days`).
    pub read_since: i64,
    pub period_start: Option<i64>,
    pub period_label: String,
    pub period_mode: String,
    pub period_inferred: bool,
    pub wallet: Option<Wallet>,
    pub wallet_error: Option<String>,
    /// `--no-wallet`: the daemon route is off, so no poll is attempted.
    pub no_wallet: bool,
}

/// `(rows, cols)` are the terminal's; a known tiny one gets the compact line.
fn compact_frame(rows: usize, cols: usize) -> bool {
    cols > 0 && (rows < 16 || cols < 40)
}

pub fn run(mut config: Loop<'_>) {
    let ink = render::Ink::new(config.colour);
    let mut out = std::io::stdout();
    let mut prev_lines = 0usize;
    let mut history: Vec<f64> = Vec::new();
    let mut last_five: Option<f64> = None;
    let mut over = false;
    let interval = config.interval;
    let colour = config.colour;
    loop {
        // Re-ask each tick, keeping the last good answer through a blip: the
        // number on screen is still the daemon's, so nothing became unavailable.
        if !config.no_wallet {
            match wallet::fetch() {
                Ok(fresh) => {
                    config.wallet = Some(fresh);
                    config.wallet_error = None;
                }
                Err(why) => {
                    if config.wallet.is_none() {
                        config.wallet_error = why.reason();
                    }
                }
            }
        }
        let now = window::now_ms();
        let (rows, read_error) = match db::read_rows(config.db_path, config.read_since) {
            Ok(rows) => (rows, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        let mut report = window::build(
            &rows,
            config.catalog,
            config.plan_id,
            now,
            config.period_start,
        );
        report.period_label = config.period_label.clone();
        report.period_end_ms =
            period::end(report.since_ms, &config.period_mode, config.period_inferred);
        report.wallet = config.wallet.clone();
        report.wallet_error = config.wallet_error.clone();

        let (term_rows, cols) = crate::term_size().unwrap_or((0, 0));
        let cols_opt = (cols > 0).then_some(cols);
        let delta = last_five
            .map(|prev| (report.five_hour.credits - prev).max(0.0))
            .unwrap_or(0.0);
        last_five = Some(report.five_hour.credits);
        if config.burst_on {
            history.push(delta);
            if history.len() > config.burst_cap {
                history.remove(0);
            }
        }
        if config.notify_on_cap {
            // OpenDesign limits the plan, so one verdict covers every window.
            let now_over = window::over_window(&report, config.plan);
            if let Some(name) = now_over {
                if !over {
                    crate::notify::cap(
                        "oduse: limit exceeded",
                        &format!("OpenDesign {name} window is over its cap"),
                    );
                }
            }
            over = now_over.is_some();
        }
        // A vanished store replaces the dashboard with one line inside the same
        // frame: an `eprintln` here would sit outside the in-place UI and scroll
        // the redraw contract away.
        let text = match &read_error {
            Some(error) => format!("{}oduse: {error}{}", ink.bold, ink.reset),
            None => {
                let burst_slice: &[f64] = if config.burst_on { &history } else { &[] };
                if compact_frame(term_rows, cols) {
                    render::compact_line(&report, config.plan, burst_slice, colour)
                } else {
                    render::watch_frame(
                        &report,
                        config.plan,
                        config.db_path,
                        config.rows,
                        colour,
                        burst_slice,
                        interval,
                        config.bar_width,
                    )
                }
            }
        };
        let update_box = config
            .update
            .as_ref()
            .map(|m| crate::render::update_box(m, cols_opt, colour));
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
        crate::refresh_tick(interval, |remaining| {
            let msg = format!(
                "\r\x1b[2K{}refreshing every {interval}s · next refresh in {remaining}s · ctrl-c to quit{}",
                ink.dim, ink.reset
            );
            let _ = write!(out, "{}", crate::clip_to_width(&msg, cols_opt));
            let _ = out.flush();
        });
    }
}
