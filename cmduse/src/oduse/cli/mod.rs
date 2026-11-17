// oduse — OpenDesign usage, same CLI shape as cmduse/ocuse/arkuse.
//
// Data: the Open Design desktop app's own SQLite store (read-only) for per-turn
// tokens, and the app's local daemon for the wallet balance (`oduse::wallet`) —
// the only server-side figure that exists, since the plan's windows are
// published but not queryable.
//
// The front-end is shared: `cmduse/src/cli.rs` parses argv for all four binaries,
// `config.rs` owns the config files, `notify.rs` the desktop notice,
// `update_check.rs` the crates.io line. oduse supplies its own source and
// renderers, plus the three pieces a fourth source needed: a context, the
// subcommand dispatch, and the dashboard frame.
//
// Lives in the library so `oduse` and its `odusedev` twin share one entry point.
mod ctx;
mod dispatch;
mod frame;

use crate::cli::{self, Binary, SubCmd};
use crate::oduse::args;
use crate::oduse::od;
use crate::oduse::opencode;
use crate::oduse::wallet::{self, Wallet};
use crate::oduse::window;
use crate::oduse::{db, period, render};
use ctx::Ctx;

/// Resolve the wallet route once per run: `--no-wallet` is a choice (no reason),
/// a closed app or an expired control key is a one-line reason.
fn read_wallet(args: &cli::Args) -> (Option<Wallet>, Option<String>) {
    if args.no_wallet {
        return (None, None);
    }
    match wallet::fetch() {
        Ok(wallet) => (Some(wallet), None),
        Err(why) => (None, why.reason()),
    }
}

pub fn run() {
    let (argv, model_id) = args::split_model_id(std::env::args_os().collect());
    let args = match cli::parse_args_from(argv, Binary::Oduse) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if args.help {
        cli::usage(Binary::Oduse);
        return;
    }
    if let Some(cs) = args.config_set {
        if let Err(e) = crate::config::set(Binary::Oduse, &cs) {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
        return;
    }
    if args.dismiss_update {
        match crate::update_check::latest_newer() {
            Ok(Some(v)) => match crate::config::set_dismissed(Binary::Oduse, &v) {
                Ok(()) => println!("dismissed update notice for {v}"),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            },
            Ok(None) => println!("oduse is up to date ({})", env!("CARGO_PKG_VERSION")),
            Err(e) => {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let cfg = crate::config::load(Binary::Oduse);
    let colours = !args.plain && crate::render::color_enabled();
    let db_path = args.db.clone().unwrap_or_else(db::default_path);
    // The harness store is the second source and has no shared flag: `--db` is
    // the app's store, so this one is configured by env alone (`OD_OPENCODE_DB`,
    // then opencode's own `$OPENCODE_DB`).
    let opencode_path = opencode::default_path();
    let now = window::now_ms();

    // `plans` needs neither the store nor a plan id: the catalogue is static.
    if let Some(SubCmd::Plans) = args.subcmd {
        if args.json {
            print!("{}", render::plans_json());
        } else {
            print!("{}", render::plans_text(colours));
        }
        return;
    }

    // Which plan the caps belong to: told, because the store records no
    // subscription and the wallet reports a balance rather than a tier.
    let catalog = od::catalog();
    let plan_id = args
        .plan
        .clone()
        .unwrap_or_else(|| od::DEFAULT_PLAN.to_string());
    let Some(plan) = catalog.plan(&plan_id) else {
        eprintln!(
            "oduse: --plan expects one of {} (got {plan_id})",
            catalog.plan_ids().join(", ")
        );
        std::process::exit(2);
    };

    // `models` is the catalogue: no store read.
    if let Some(SubCmd::Models) = args.subcmd {
        if args.json {
            print!("{}", render::models_json(&plan_id));
        } else {
            print!("{}", render::models_text(&plan_id, colours));
        }
        return;
    }

    // `--since` (an ISO-8601 instant) pins the report window, as in cmduse. It
    // yields epoch milliseconds — the same units as the store's `created_at`.
    let since_override = args
        .since
        .as_deref()
        .and_then(cmduse_core::dates::parse_iso_utc)
        .map(|ms| ms as i64);
    let period = match period::resolve(&args, now, since_override) {
        Ok(period) => period,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let (wallet, wallet_error) = read_wallet(&args);
    let days: i64 = args.last.unwrap_or(120) as i64;
    let ctx = Ctx {
        args: &args,
        cfg: &cfg,
        catalog: &catalog,
        plan,
        plan_id: &plan_id,
        db_path: &db_path,
        opencode_path: &opencode_path,
        model_id: model_id.as_deref(),
        days,
        hours: args.hours.unwrap_or(24) as i64,
        now,
        tz_secs: args.tz.unwrap_or(0),
        colours,
        fmt: args::output_fmt(&args),
        period: &period,
        wallet,
        wallet_error,
        report_window: since_override.unwrap_or(now - days * 86_400_000),
    };
    if dispatch::subcommand(&ctx) {
        return;
    }
    frame::dashboard(&ctx);
}
