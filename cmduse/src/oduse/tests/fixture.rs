// Shared fixtures: a report built from hand-made rows, so the render and MCP
// tests never read this machine's app store.
use crate::oduse::db::Row;
use crate::oduse::od::{self, Catalog, Plan};
use crate::oduse::window::{build, Report};

/// A fixed "now" far enough from the epoch that month arithmetic is real:
/// 2027-01-15T08:00:00Z.
pub const NOW_MS: i64 = 1_800_000_000_000;

pub fn catalog() -> Catalog {
    od::catalog()
}

pub fn plan(id: &str) -> Plan {
    od::catalog().plan(id).expect("plan exists").clone()
}

/// One row of `input`/`output` tokens on `model`.
pub fn row(at_ms: i64, model: &str, input: u64, output: u64) -> Row {
    Row {
        at_ms,
        session: "conv_fixture".into(),
        project: "Greeting and Next Steps".into(),
        model: model.into(),
        input,
        output,
        duration_ms: Some(1_000),
    }
}

/// The catalog's own report over those rows, with the period pinned to the
/// calendar month so the figures do not depend on today's date.
pub fn report(rows: &[Row]) -> Report {
    let mut report = build(
        rows,
        &catalog(),
        od::DEFAULT_PLAN,
        NOW_MS,
        Some(crate::oduse::window::calendar_month_start(NOW_MS)),
    );
    report.period_label = "calendar month".into();
    report.period_end_ms = Some(crate::oduse::window::next_month(report.since_ms));
    report
}

/// The shape this machine's store actually holds: one turn, 30,892 in / 147 out
/// on DeepSeek V4.1 Flash.
pub fn live_report() -> Report {
    report(&[row(NOW_MS - 60_000, "deepseek-v4.1-flash", 30_892, 147)])
}
