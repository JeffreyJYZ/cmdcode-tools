// Poll cadences, spawn bounds and cache TTLs.

/** Sidebar poll cadence: one cmduse/ocuse spawn plus the local store reads. */
export const POLL_MS = 5_000;

/** How long one sidebar CLI spawn may run before it is killed. An outage can
 * leave a fetch hanging through cmduse's retry ladder, and the poll interval
 * would otherwise stack spawns on top of each other. */
export const CHILD_TIMEOUT_MS = 30_000;

/** Process-lifetime cache for the live model list (src/models.ts). */
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Disk cache for mpc's per-model catalog (src/sidebar/data.ts). An hour, not
 * six: a running panel then picks up new models and promotions. */
export const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;

/** Re-read window for the sidebar colour prefs file (src/sidebar/prefs.ts). */
export const PREFS_CACHE_MS = 5_000;
