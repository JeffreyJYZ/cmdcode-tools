import type { Model } from "#~/model.ts";
import { normalizeRows } from "#~/model.ts";
import { type SourceResult, mergeModels } from "./normalize.ts";

export const API_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const UA = "aa-models/0.1 (+https://github.com/JeffreyJYZ/cmdcode-tools)";

/** A bounded HTTP status failure; the message names the URL a caller must fix. */
export class FetchError extends Error {
	constructor(
		readonly url: string,
		readonly status: number,
	) {
		super(`GET ${url} -> ${status} (${statusHint(status)})`);
		this.name = "FetchError";
	}
}

/**
 * One line per cause: a retired path is not a bad key, and a quota is not a
 * subscription gap. These hints are what `aa check` prints.
 */
export function statusHint(status: number): string {
	if (status === 401) return "AA_API_KEY rejected, replace the key";
	if (status === 402 || status === 403) return "this endpoint needs a Pro subscription";
	if (status === 404 || status === 410)
		return "endpoint retired, see artificialanalysis.ai/data-api";
	if (status === 429) return "daily quota spent, use the keyless sources";
	return "unexpected response";
}

/**
 * Bounded GET shared by every source: 20 s timeout, one retry on a network fault,
 * never on an HTTP status (a 404 is an answer, not a flake).
 */
export async function fetchText(url: string, key?: string): Promise<string> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const headers: Record<string, string> = { "user-agent": UA };
			if (key) headers["x-api-key"] = key;
			const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
			if (!res.ok) throw new FetchError(url, res.status);
			return await res.text();
		} catch (error) {
			if (error instanceof FetchError) throw error;
			lastError = error;
		}
	}
	throw new Error(
		`GET ${url} failed: ${lastError instanceof Error ? lastError.message : lastError}`,
	);
}

/** Pure parser over one AA API page. */
export function parseAaApi(body: unknown): { models: Model[]; indexVersion: string | null } {
	const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	const rows = Array.isArray(root.data) ? root.data : Array.isArray(body) ? body : [];
	// AA versions the index in-band and keeps the field name stable, so a score is
	// only interpretable beside this: v4 and v5 numbers are not comparable.
	const indexVersion =
		typeof root.intelligence_index_version === "string"
			? root.intelligence_index_version
			: null;
	return { models: normalizeRows(rows, "api"), indexVersion };
}

/** Full catalogue via the AA API. Needs a key, paginated, best figure per key. */
export async function loadAaApi(
	key: string,
): Promise<SourceResult & { indexVersion: string | null }> {
	const notes: string[] = [];
	const pages: Model[][] = [];
	let indexVersion: string | null = null;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const url = `${API_URL}?page=${page}&page_size=${PAGE_SIZE}`;
		let body: unknown;
		try {
			body = JSON.parse(await fetchText(url, key));
		} catch (error) {
			// A dead first page is the source being down; a dead later page keeps what
			// arrived and says so, so a flaky page never blanks the catalogue.
			if (page === 1) throw error;
			notes.push(`api page ${page}: ${error instanceof Error ? error.message : error}`);
			break;
		}
		const parsed = parseAaApi(body);
		indexVersion ??= parsed.indexVersion;
		pages.push(parsed.models);
		const more = (body as { pagination?: { has_more?: boolean } }).pagination?.has_more;
		if (!more) break;
		if (page === MAX_PAGES) notes.push(`api: stopped at the ${MAX_PAGES}-page cap`);
	}
	return { models: mergeModels(pages), notes, indexVersion };
}
