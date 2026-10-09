import { API_URL } from "#~/constants/sources.ts";
import { parseAaApi } from "./parse.ts";

/** Full catalog via the Artificial Analysis API. Needs a key. Paginated. */
export async function loadAaApi(
	key: string,
): Promise<{ intelligence: Map<string, number>; tps: Map<string, number> }> {
	const intelligence = new Map<string, number>();
	const tps = new Map<string, number>();
	const pageSize = 200;
	const maxPages = 20;

	for (let page = 1; page <= maxPages; page++) {
		const res = await fetchTextWithKey(
			`${API_URL}?page=${page}&page_size=${pageSize}`,
			key,
		);
		const body = JSON.parse(res) as unknown;
		mergeAaPage(parseAaApi(body), intelligence, tps);
		const pagination = (body as { pagination?: { has_more?: boolean } })
			.pagination;
		if (!pagination?.has_more) break;
	}

	return { intelligence, tps };
}

async function fetchTextWithKey(url: string, key: string): Promise<string> {
	const res = await fetch(url, {
		headers: { "x-api-key": key, "user-agent": "mpc/0.1" },
	});
	if (!res.ok) {
		throw new Error(
			`Artificial Analysis API ${res.status}: set AA_API_KEY or use --bench cc / aa-web`,
		);
	}
	return res.text();
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
