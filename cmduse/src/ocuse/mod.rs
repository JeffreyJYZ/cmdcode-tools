// The ocuse half of the cmduse crate: OpenCode Go/Zen usage from local data.
//
// Same shape as cmduse, different source. cmduse asks CommandCode's account API
// for credits and windows; OpenCode publishes no usage API (its one route,
// /zen/go/v1/usage, answers EntitlementError for keys without a Go
// subscription), so everything here is derived from opencode's own store plus
// the docs catalogue in core/zen.json.
pub mod cli;
pub mod db;
pub mod mcp;
pub mod render;
pub mod window;
pub mod zen;

pub use cli::run;
pub use render::{render_json, render_text, status_line};
pub use window::{build, Report, Totals, LOOKBACK_SECS};
pub use zen::catalog;
