// Entry shim for local/directory plugin loading: opencode resolves the server
// half as `index.js`/`server.js` beside the package root (package `exports` are
// only consulted for npm-installed plugins). Keep in sync with ./dist output.
export { default } from "./dist/index.js";
