// The arkuse half of the cmduse crate: Volcengine ARK Agent Plan usage.
//
// Same CLI shape as cmduse and ocuse, different source and a different unit.
// The plan is billed in AFP (1 AFP = ¥0.002 at every tier), not dollars, and the
// authoritative figures come from the control plane through `arkcli` — the
// console's own 5-hour / weekly / monthly meters, the only view that can see
// another machine or another harness on the same subscription.
//
// opencode's store is the second source, not a substitute: filtered to
// `provider = "agent-plan"` it carries per-model attribution and a
// reconciliation against the documented coefficients, but it cannot know the
// server's window anchors, and it holds no AFP at all — the catalogue turns
// tokens into AFP.
pub mod api;
pub mod ark;
pub mod cli;
pub mod db;
pub mod mcp;
pub mod render;
pub mod window;

pub use cli::run;
pub use render::{render_json, render_text, statusline_template};
pub use window::{build, Report, Totals, LOOKBACK_SECS};
