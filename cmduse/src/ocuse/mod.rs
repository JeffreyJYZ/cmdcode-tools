// The ocuse half of the cmduse crate: OpenCode Go/Zen usage.
//
// Same shape as cmduse, different source. cmduse asks CommandCode's account API
// for credits and windows; here the window figures come from OpenCode Go's own
// usage endpoint when the account has a Go key (see [`api`]) — the numbers the
// console shows. Everything else is derived from opencode's own store plus the
// docs catalogue in core/zen.json.
//
// The store alone cannot reproduce the account's windows: the server's 5-hour
// window is a block with its own reset instant, its week is Monday-anchored, its
// month is the subscription anniversary, and it meters with its own price basis.
// So the local derivation is a fallback, not the primary source.
pub mod api;
pub mod cli;
pub mod db;
pub mod mcp;
pub mod render;
pub mod window;
pub mod zen;

pub use cli::run;
pub use render::{render_json, render_text, statusline_template};
pub use window::{build, Report, Totals, LOOKBACK_SECS};
pub use zen::catalog;
