// Entry shim for local/directory plugin loading: opencode resolves the TUI
// half as a literal `tui.js` beside the package root (package `exports` are
// only consulted for npm-installed plugins). Keep in sync with the built
// ./tui output.
export { default } from "./dist/tui.js";
