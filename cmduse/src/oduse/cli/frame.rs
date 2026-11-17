// The dashboard: one-shot, or the live watch loop.
//
// The update check runs before any output; watch mode draws the notice inside the
// redrawn frame (an `eprintln` would sit outside the in-place UI and scroll away),
// one-shot has no frame so it goes to stderr.
use crate::oduse::render;
use crate::oduse::{args, watch};

use super::ctx::Ctx;

pub fn dashboard(ctx: &Ctx) {
    let interval = ctx
        .args
        .interval
        .unwrap_or(ctx.cfg.interval_secs)
        .clamp(1, 86_400);
    let bar_width = ctx.bar_width();
    let (burst_on, burst_cap) = args::burst_config(
        ctx.args.bursts,
        ctx.cfg.burst_enabled,
        ctx.cfg.burst_samples,
    );
    let update =
        crate::update_check::check_sync(ctx.cfg.check_updates, ctx.cfg.dismissed_update.as_deref());

    if !args::wants_watch(ctx.args) {
        if let Some(msg) = &update {
            eprintln!("{msg}");
        }
        let report = ctx.report(ctx.now);
        if ctx.args.json {
            println!("{}", render::render_json(&report, ctx.plan));
        } else {
            print!(
                "{}",
                render::render_text(
                    &report,
                    ctx.plan,
                    ctx.db_path,
                    ctx.rows_cap(15),
                    ctx.colours,
                    bar_width,
                )
            );
        }
        return;
    }

    watch::run(watch::Loop {
        db_path: ctx.db_path,
        opencode_path: ctx.opencode_path,
        catalog: ctx.catalog,
        plan: ctx.plan,
        plan_id: ctx.plan_id,
        rows: ctx.rows_cap(15),
        colour: ctx.colours,
        bar_width,
        interval,
        burst_on,
        burst_cap,
        notify_on_cap: ctx.cfg.notify_on_cap,
        update,
        read_since: ctx.report_window,
        period_start: ctx.period.start,
        period_label: ctx.period.label.clone(),
        period_mode: ctx.period.mode.clone(),
        period_inferred: ctx.period.inferred,
        wallet: ctx.wallet.clone(),
        wallet_error: ctx.wallet_error.clone(),
        no_wallet: ctx.args.no_wallet,
    });
}
