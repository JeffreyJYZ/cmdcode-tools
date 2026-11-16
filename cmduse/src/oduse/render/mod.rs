// oduse's presentation. Split by surface rather than by size: the frame, the
// status line, the report tables and the catalogues each own their file, so a
// change to one cannot silently reformat another.
pub mod catalog;
pub mod dash;
pub mod ink;
pub mod json;
pub mod live;
pub mod model_table;
pub mod report;
pub mod status;
pub mod wallet;
pub mod windows;

pub use catalog::{models_json, models_text, plans_json, plans_text};
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
