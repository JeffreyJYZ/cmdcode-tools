// Entry shim for local/directory plugin loading: opencode resolves the server
// half as `index.js`/`server.js` beside the package root and the TUI half as a
// literal `tui.js` (package `exports` are only consulted for npm-installed
// plugins). Keep in sync with the built ./dist output.
export { default } from "./dist/index.js";
