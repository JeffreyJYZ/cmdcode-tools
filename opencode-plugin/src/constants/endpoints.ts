// Host endpoints shared by the account client and the provider lanes.

/** Command Code account/billing API. */
export const API_BASE = "https://api.commandcode.ai";

/** Provider (inference) API root; the lanes append their wire path. */
export const PROVIDER_BASE = `${API_BASE}/provider/v1`;

/** Default provider base URL used when the host passes none. */
export const DEFAULT_BASE_URL = API_BASE;
