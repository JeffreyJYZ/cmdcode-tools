// Path segments for the caches, diagnostics and stores the plugin reads/writes.
// The XDG bases (`$XDG_CACHE_HOME` / `$XDG_CONFIG_HOME` / `$XDG_DATA_HOME`, each
// with a homedir fallback) stay in the callers; only the segments we own live
// here.

/** Dir segment under an XDG base that holds our caches/diagnostics. */
export const CACHE_DIR = "command-code";

/** Live model list disk cache file (under CACHE_DIR). */
export const MODELS_CACHE_FILE = "models.json";

/** Startup timing log file (under CACHE_DIR). */
export const STARTUP_LOG_FILE = "startup.log";

/**
 * mpc per-model catalog disk cache file (under CACHE_DIR), one per OpenCode Go
 * plan: mpc bakes the selected plan's per-model allowance into the rows, so a
 * cached catalog is only valid for the plan it was fetched under.
 */
export function ccCatalogFile(plan: string): string {
	return `cc-catalog-${plan}.json`;
}

/** opencode's own config/data dir segment. */
export const OPENCODE_DIR = "opencode";

/** opencode's message store file (under OPENCODE_DIR in the data root). */
export const OPENCODE_DB_FILE = "opencode.db";

/** Sidebar prefs file (under OPENCODE_DIR in the config root). */
export const PREFS_FILE = "command-code.json";
