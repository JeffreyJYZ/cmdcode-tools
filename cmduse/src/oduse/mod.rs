// The oduse half of the cmduse crate: OpenDesign (open-design.ai) usage.
//
// Same CLI shape as cmduse/ocuse/arkuse, one source and one optional meter:
// the Open Design desktop app's own SQLite store (read-only) for per-turn
// tokens, and two wallet routes: the account's own balance API (a user-supplied
// console session cookie, preferred when present) then the app's local daemon.
// There is no per-window usage API — the plan's 5-hour / 7-day / monthly windows
// are published but not queryable — so the windows are computed here and labelled
// an estimate, while the wallet (a $ balance) prints beside them as the one
// server-side number that exists.
//
// Usage events carry no cache tokens, which understates a cache-heavy turn; the
// docs say so once and the dashboard says `estimate`.
pub mod api_wallet;
pub mod args;
pub mod caps;
pub mod cli;
pub mod db;
pub mod events;
pub mod help;
pub mod mcp;
pub mod meter;
pub mod od;
pub mod opencode;
pub mod period;
pub mod price;
pub mod render;
pub mod snapshot;
pub mod snapshot_window;
pub mod sources;
pub mod wallet;
pub mod watch;
pub mod window;

pub use cli::run;
pub use render::{render_json, render_text, statusline_template};
pub use window::{build, Report, Totals, LOOKBACK_SECS};

#[cfg(test)]
mod tests;
