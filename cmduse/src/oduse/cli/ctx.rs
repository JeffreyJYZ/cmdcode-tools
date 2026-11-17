// What every oduse command needs, resolved once by `run`.
//
// Bundled rather than reassembled per command so a new flag or a new source does
// not grow every signature in the dispatch — and so the report builder (read the
// store, build, stamp the period and the wallet) exists once.
use crate::cli;
use crate::config::Config;
use crate::oduse::db::{self, Row};
use crate::oduse::od::{Catalog, Plan};
use crate::oduse::period::Period;
use crate::oduse::wallet::Wallet;
use crate::oduse::window::{self, Report};
use crate::report_render::Fmt;

pub struct Ctx<'a> {
    pub args: &'a cli::Args,
    pub cfg: &'a Config,
    pub catalog: &'a Catalog,
    pub plan: &'a Plan,
    pub plan_id: &'a str,
    pub db_path: &'a str,
    /// `model <id>`'s positional, already pulled out of argv.
    pub model_id: Option<&'a str>,
    pub days: i64,
    pub hours: i64,
    pub now: i64,
    pub tz_secs: i64,
    pub colours: bool,
    pub fmt: Fmt,
    pub period: &'a Period,
    pub wallet: Option<Wallet>,
    pub wallet_error: Option<String>,
    /// The report's read cutoff: an explicit `--since`, else `--days`.
    pub report_window: i64,
}

impl Ctx<'_> {
    /// Read the store, or exit with the two things a first run needs: the error
    /// and the flag that points elsewhere.
    pub fn read(&self, since_ms: i64) -> Vec<Row> {
        match db::read_rows(self.db_path, since_ms) {
            Ok(rows) => rows,
            Err(error) => {
                eprintln!("oduse: {error}");
                eprintln!(
                    "hint: --db <path>, or OD_DB; the store is created by the Open Design app"
                );
                std::process::exit(1);
            }
        }
    }

    /// One report at `t`: the period's rows, the period's label and bounds, and
    /// the wallet snapshot the caller resolved.
    pub fn report(&self, t: i64) -> Report {
        let mut report = window::build(
            &self.read(self.report_window),
            self.catalog,
            self.plan_id,
            t,
            self.period.start,
        );
        report.period_label = self.period.label.clone();
        report.period_end_ms =
            crate::oduse::period::end(report.since_ms, &self.period.mode, self.period.inferred);
        report.wallet = self.wallet.clone();
        report.wallet_error = self.wallet_error.clone();
        report
    }

    /// `--rows` resolved against this command's default.
    pub fn rows_cap(&self, default: usize) -> usize {
        self.args.rows_cap(default)
    }

    pub fn bar_width(&self) -> usize {
        self.args
            .bar_width
            .unwrap_or(self.cfg.bar_width)
            .clamp(5, 200)
    }
}
