// Poll cadences, spawn bounds and cache TTLs. The sidebar's own cadence is a
// setting (`prefs.pollMs`), so no fixed interval lives here.

/** How long one sidebar CLI spawn may run before it is killed. An outage can
 * leave a fetch hanging through cmduse's retry ladder, and the poll interval
 * would otherwise stack spawns on top of each other. */
export const CHILD_TIMEOUT_MS = 30_000;

/** Process-lifetime cache for the live model list (src/models.ts). */
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Live model-catalogue document (prices, context, efforts) fetched from the
 * published CLI package. A day: rates change on a release cadence, not hourly,
 * and every fetch costs a CDN round trip at startup. */
export const CATALOG_LIVE_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard stop for one catalogue download; a hung CDN must not delay startup. */
export const CATALOG_LIVE_TIMEOUT_MS = 10_000;

/** Disk cache for mpc's per-model catalog (src/sidebar/data.ts). An hour, not
 * six: a running panel then picks up new models and promotions. */
export const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;

/** Hard stop for OpenDesign's `/v1/models` listing. Matches the Command Code
 * listing's 15s: both are one small JSON document, and the caller keeps its seed
 * on a timeout rather than waiting longer for a picker row. */
export const OPEN_DESIGN_TIMEOUT_MS = 15_000;

/** Re-read window for the sidebar colour prefs file (src/sidebar/prefs.ts). */
export const PREFS_CACHE_MS = 5_000;

/** How long one `oduse` sidebar spawn may run. Shorter than the account bound
 *  above: it reads a local SQLite store and asks the desktop app's daemon for a
 *  wallet with a 300 ms timeout, so there is no remote retry ladder to wait out —
 *  and a store the app has not created yet exits at once with its own reason. */
export const OD_CHILD_TIMEOUT_MS = 12_000;

/** Process-lifetime cache for the ARK sidebar snapshot: every `arkuse` run
 * shells out to `arkcli` for the plan meters, so polling it at the 5s cadence
 * would be one control-plane round-trip per tick. A minute keeps the meters
 * fresh enough while the store-backed rows still update on the poll. */
export const ARK_SNAPSHOT_TTL_MS = 60_000;
