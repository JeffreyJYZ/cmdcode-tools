// What every oduse command needs, resolved once by `run`.
//
// Bundled rather than reassembled per command so a new flag or a new source does
// not grow every signature in the dispatch — and so the report builder (read the
// store, build, stamp the period and the wallet) exists once.
use crate::cli;
use crate::config::Config;
use crate::oduse::meter::Source;
use crate::oduse::od::{Catalog, Plan};
use crate::oduse::period::Period;
use crate::oduse::sources;
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
    /// The harness store (`opencode.db`), a second source for the same plan.
    pub opencode_path: &'a str,
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
    /// Which meter supplied `wallet`: the account API or the local daemon.
    pub wallet_source: Option<Source>,
    /// `--session-cookie <path>`, stripped by `args` before the shared parser.
    pub session_cookie: Option<String>,
    /// API host, resolved once (`$OD_API_URL` over the console endpoint).
    pub api_base: String,
    /// The report's read cutoff: an explicit `--since`, else `--days`.
    pub report_window: i64,
}

impl Ctx<'_> {
    /// Read both stores, or exit with the two things a first run needs: the error
    /// and the flag that points elsewhere.
    ///
    /// The desktop store is required — it is the one the app creates — while the
    /// harness store is optional and degrades to one note on the report.
    pub fn read(&self, since_ms: i64) -> sources::Sources {
        match sources::read(self.db_path, self.opencode_path, since_ms) {
            Ok(found) => found,
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
        let found = self.read(self.report_window);
        let mut report = window::build(
            &found.rows,
            self.catalog,
            self.plan_id,
            t,
            self.period.start,
        );
        report.period_label = self.period.label.clone();
        report.period_end_ms =
            crate::oduse::period::end(report.since_ms, &self.period.mode, self.period.inferred);
        report.period_anchored = self.period.anchored;
        report.wallet = self.wallet.clone();
        report.wallet_error = self.wallet_error.clone();
        report.wallet_source = self.wallet_source;
        // The account's own windows, when a cookie answered. Same credential as
        // the wallet, resolved here so every report/frame sees one answer, and
        // no request at all when there is no cookie.
        let snapshot =
            crate::oduse::snapshot::resolve(self.session_cookie.as_deref(), &self.api_base);
        report.snapshot = snapshot.snapshot;
        report.snapshot_error = snapshot.error;
        report.sources = found.names;
        report.notes = found.notes;
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
