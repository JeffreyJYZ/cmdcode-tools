// oduse's presentation. Split by surface rather than by size: the frame, the
// status line, the report tables and the catalogues each own their file, so a
// change to one cannot silently reformat another.
pub mod caps;
pub mod catalog;
pub mod catalog_json;
pub mod dash;
pub mod ink;
pub mod json;
pub mod live;
pub mod model_table;
pub mod report;
pub mod snapshot;
pub mod status;
pub mod wallet;
pub mod windows;

pub use catalog::{models_text, plans_text};
pub use catalog_json::{models_json, plans_json};
pub use dash::render_text;
pub use ink::Ink;
pub use json::render_json;
pub use live::{compact_line, watch_frame};
pub use report::{bucket_text, model_report, model_text, session_text};
pub use status::{statusline_json, statusline_template};

/// Gauge width when neither config nor `--bar-width` says otherwise.
pub const DEFAULT_BAR_WIDTH: usize = 20;

/// `YYYY-MM-DD` for a Unix day number — `cmduse_core::dates::civil_from_days`,
/// so the four binaries cannot drift on the calendar.
pub fn date_of(day: i64) -> String {
    cmduse_core::dates::civil_from_days(day)
}

/// `$HOME` shortened to `~`, for the store path in the header.
pub fn shorten(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() => path.replacen(&home, "~", 1),
        _ => path.to_string(),
    }
}

/// The catalogue's origin as one JSON object, read by the dashboard JSON, the
/// statusline and the two catalogue commands so no surface can disagree on
/// whether the figures below are live, cached or the baked seed.
///
/// `ratesFrom` and `multipliersFrom` are separate on purpose: the price list
/// publishes token rates only, so the multiplier beside every rate is always the
/// baked file's. `error` is set only when the seed answered, and `ageSecs` only
/// on a cache answer.
pub fn catalog_json() -> serde_json::Value {
    let p = crate::oduse::od::catalog().provenance;
    let rates_from = if p.models > 0 {
        "price-list"
    } else {
        "builtin"
    };
    serde_json::json!({
        "source": p.kind(),
        // When the list was fetched (`live`) or written to the cache (`cache`);
        // null for the seed, which carries only its build date.
        "at": p.at,
        "ageSecs": p.age_secs,
        "rowsLive": p.models,
        "rowsUnlisted": p.unlisted,
        "ratesFrom": rates_from,
        "multipliersFrom": "builtin",
        "error": p.error,
    })
}
