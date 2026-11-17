// `opencode.db` as an OpenDesign source.
//
// The plan is spent wherever its models are called, and on this machine that is
// mostly opencode: providers `open-design` and `open-design-tmp` (the latter a
// hand-written provider block). Both are matched by the `open-design` prefix so a
// rename — `open-design-x` — cannot silently drop every turn.
//
// The reader is `ocuse::db::read_with`, the same one `ocuse` uses for
// `opencode.db`; this file only supplies the provider predicate and maps the rows
// into oduse's `Row`. A second reader would be the drift this repo makes a rule
// against.
//
// Dedupe: the desktop app proxies opencode (`agent_sessions.session_id` is a
// `ses_…` id), so one turn can be visible from both stores. When opencode holds a
// session the app names, the app's row is dropped: opencode's copy carries the
// cache counters, so it is the complete record of the same turn.
use crate::ocuse::db as ocuse_db;
use crate::oduse::db::{Row, OPENCODE};

/// Providers whose id starts with this are this plan's traffic.
pub const PREFIX: &str = "open-design";

/// Does this provider id belong to the plan?
pub fn is_plan_provider(provider: &str) -> bool {
    provider.starts_with(PREFIX)
}

/// Default location: `$OD_OPENCODE_DB`, else `$OPENCODE_DB`, else the XDG store.
///
/// `$OPENCODE_DB` is honored because a machine that already moved opencode's
/// store has told this binary where it is once; the OD-specific name wins so the
/// two can still be pointed apart.
pub fn default_path() -> String {
    if let Ok(path) = std::env::var("OD_OPENCODE_DB") {
        if !path.trim().is_empty() {
            return path;
        }
    }
    ocuse_db::default_path()
}

/// Every plan turn opencode recorded at or after `since_ms`, oldest first.
pub fn read_rows(path: &str, since_ms: i64) -> Result<Vec<Row>, String> {
    let rows = ocuse_db::read_with(path, since_ms, is_plan_provider)?;
    Ok(rows.into_iter().map(into_row).collect())
}

/// opencode's row shape into this module's; `reasoning` is deliberately dropped.
///
/// opencode bills `reasoning` inside `output` (the same rule `arkuse::db`
/// documents), and `core/od.json` has no reasoning rate, so adding it again would
/// inflate output — measured at 470k tokens a month on this machine.
fn into_row(row: ocuse_db::Row) -> Row {
    Row {
        at_ms: row.at_ms,
        session: row.session.clone(),
        project: String::new(),
        model: row.model,
        input: row.input,
        output: row.output,
        cache_read: row.cache_read,
        cache_write: row.cache_write,
        duration_ms: None,
        source: OPENCODE,
        upstream_session: Some(row.session),
        recorded_cost: row.cost_usd,
    }
}
