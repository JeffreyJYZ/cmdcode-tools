// The report subcommands. `plans`/`models` are served in `run` (they need no
// store), so this match only covers the commands that read it — plus `mcp`,
// which hands the whole context to the stdio server.
//
// Returns true when the command was handled, so the caller knows whether the
// dashboard frame is still due.
use crate::cli::SubCmd;
use crate::oduse::{mcp, render};
use crate::report_render::Fmt;

use super::ctx::Ctx;

pub fn subcommand(ctx: &Ctx) -> bool {
    match ctx.args.subcmd {
        Some(SubCmd::Statusline) => {
            let report = ctx.report(ctx.now);
            if ctx.args.json {
                println!("{}", render::statusline_json(&report, ctx.plan));
            } else {
                print!(
                    "{}",
                    render::statusline_template(
                        &report,
                        ctx.plan,
                        &ctx.cfg.statusline_template,
                        ctx.cfg.statusline_colors,
                        ctx.cfg.statusline_ascii,
                        ctx.cfg.bar_width.min(30),
                    )
                );
            }
        }
        Some(SubCmd::Daily) => print!(
            "{}",
            render::bucket_text(
                &ctx.read(ctx.now - ctx.days * 86_400_000).rows,
                ctx.catalog,
                ctx.now,
                ctx.days * 86_400_000,
                86_400_000,
                ctx.tz_secs,
                ctx.colours,
                ctx.fmt,
                ctx.rows_cap(usize::MAX),
            )
        ),
        Some(SubCmd::Hours) => print!(
            "{}",
            render::bucket_text(
                &ctx.read(ctx.now - ctx.hours * 3_600_000).rows,
                ctx.catalog,
                ctx.now,
                ctx.hours * 3_600_000,
                3_600_000,
                ctx.tz_secs,
                ctx.colours,
                ctx.fmt,
                ctx.rows_cap(usize::MAX),
            )
        ),
        Some(SubCmd::Session) => print!(
            "{}",
            render::session_text(
                &ctx.read(ctx.report_window).rows,
                ctx.catalog,
                ctx.rows_cap(20),
                ctx.colours,
                ctx.fmt,
            )
        ),
        Some(SubCmd::Mcp) => {
            // stdio JSON-RPC; stdout carries protocol only, so nothing else may
            // print. The wallet is handed in, resolved once for the whole run.
            mcp::run(mcp::Settings {
                db_path: ctx.db_path,
                opencode_path: ctx.opencode_path,
                days: ctx.days,
                tz_secs: ctx.tz_secs,
                colour: false,
                plan: ctx.plan_id,
                period_start: ctx.period.start,
                wallet: ctx.wallet.as_ref(),
                wallet_error: ctx.wallet_error.as_deref(),
            });
        }
        Some(SubCmd::Model) => {
            let report = ctx.report(ctx.now);
            if ctx.fmt == Fmt::Table {
                match ctx.model_id {
                    Some(id) => print!("{}", render::model_text(&report, id, ctx.colours)),
                    None => print!(
                        "{}",
                        render::render_text(
                            &report,
                            ctx.plan,
                            ctx.db_path,
                            ctx.rows_cap(usize::MAX),
                            ctx.colours,
                            ctx.bar_width(),
                        )
                    ),
                }
            } else {
                print!("{}", render::model_report(&report, ctx.model_id, ctx.fmt));
            }
        }
        // served in `run`: the catalogues need no store read
        Some(SubCmd::Plans) | Some(SubCmd::Models) => {}
        None => return false,
    }
    true
}
