import { API_URL } from "#~/constants/sources.ts";
import { parseAaApi } from "./parse.ts";

/** Full catalog via the Artificial Analysis API. Needs a key. Paginated. */
export async function loadAaApi(
	key: string,
): Promise<{ intelligence: Map<string, number>; tps: Map<string, number>; indexVersion?: string }> {
	const intelligence = new Map<string, number>();
	const tps = new Map<string, number>();
	const pageSize = 200;
	const maxPages = 20;
	let indexVersion: string | undefined;

	for (let page = 1; page <= maxPages; page++) {
		const res = await fetchTextWithKey(`${API_URL}?page=${page}&page_size=${pageSize}`, key);
		const body = JSON.parse(res) as unknown;
		const parsed = parseAaApi(body);
		indexVersion ??= parsed.indexVersion;
		mergeAaPage(parsed, intelligence, tps);
		const pagination = (body as { pagination?: { has_more?: boolean } }).pagination;
		if (!pagination?.has_more) break;
	}

	return indexVersion ? { intelligence, tps, indexVersion } : { intelligence, tps };
}

async function fetchTextWithKey(url: string, key: string): Promise<string> {
	const res = await fetch(url, {
		headers: { "x-api-key": key, "user-agent": "mpc/0.1" },
	});
	if (!res.ok) {
		throw new Error(`Artificial Analysis API ${res.status}: ${statusHint(res.status)}`);
	}
	return res.text();
}

/** One line per cause: a retired path is not a bad key, and the old message
 * blamed credentials for every status. */
function statusHint(status: number): string {
	if (status === 401) return "AA_API_KEY rejected, replace the key";
	if (status === 403)
		return "this endpoint needs a Pro subscription, the free list is /language/models/free";
	if (status === 404 || status === 410)
		return "endpoint retired, see artificialanalysis.ai/data-api";
	if (status === 429) return "daily quota spent, use --bench cc / aa-web";
	return "unexpected response, use --bench cc / aa-web";
}

/** Keep the best variant per key; AA lists a row per reasoning effort. */
function mergeAaPage(
	page: { intelligence: Map<string, number>; tps: Map<string, number> },
	intelligence: Map<string, number>,
	tps: Map<string, number>,
): void {
	for (const [key, value] of page.intelligence) {
		if (!intelligence.has(key) || value > (intelligence.get(key) ?? 0)) {
			intelligence.set(key, value);
		}
	}
	for (const [key, value] of page.tps) {
		if (!tps.has(key) || value > (tps.get(key) ?? 0)) tps.set(key, value);
	}
}
