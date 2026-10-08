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

/** mpc per-model catalog disk cache file (under CACHE_DIR). */
export const CC_CATALOG_FILE = "cc-catalog.json";

/** opencode's own config/data dir segment. */
export const OPENCODE_DIR = "opencode";

/** opencode's message store file (under OPENCODE_DIR in the data root). */
export const OPENCODE_DB_FILE = "opencode.db";

/** Sidebar prefs file (under OPENCODE_DIR in the config root). */
export const PREFS_FILE = "command-code.json";
