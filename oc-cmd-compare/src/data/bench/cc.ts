import { PAGES, TPS_HEADER } from "#~/constants/sources.ts";
import { extractNumericColumn, fetchText, parseTables } from "#~/data/scrape/index.ts";
import { decodeFlight, readArray } from "#~/data/bench/flight.ts";
import { aaKeyVariants } from "#~/keys.ts";
import { type BenchData, emptyData } from "./types.ts";

interface CcModel {
	slug?: unknown;
	name?: unknown;
	intelligenceIndex?: unknown;
}

/** CommandCode's docs now embed the scored model catalog in the page's RSC
 * flight payload (`"models"` array), not in an HTML table. Unscored rows carry
 * the literal `"$undefined"`, so only a real positive number is a score. */
export function parseCcFlight(html: string): BenchData {
	const data = emptyData();
	const models = readArray(decodeFlight(html) || html, "models");
	if (!models) return data;
	for (const raw of models) {
		const model = (raw ?? {}) as CcModel;
		const iq = model.intelligenceIndex;
		if (typeof iq !== "number" || !Number.isFinite(iq) || iq <= 0) continue;
		const keys = new Set([
			...(typeof model.slug === "string" ? aaKeyVariants(model.slug) : []),
			...(typeof model.name === "string" ? aaKeyVariants(model.name) : []),
		]);
		for (const key of keys) {
			if (key && !data.intelligence.has(key)) data.intelligence.set(key, iq);
		}
	}
	return data;
}

export async function loadCc(): Promise<BenchData> {
	const pages = await Promise.all(
		PAGES.map(async (url) => {
			const html = await fetchText(url);
			return { html, tables: await parseTables(html) };
		}),
	);
	const data = emptyData();
	for (const page of pages) {
		// The flight array is the primary score source; the table path stays as a
		// backstop for a docs layout that still publishes an Intelligence column.
		for (const [key, score] of parseCcFlight(page.html).intelligence) {
			if (!data.intelligence.has(key)) data.intelligence.set(key, score);
		}
		for (const [key, score] of extractNumericColumn(page.tables, /intelligence/i)) {
			if (!data.intelligence.has(key)) data.intelligence.set(key, score);
		}
		for (const [key, tps] of extractNumericColumn(page.tables, TPS_HEADER)) {
			if (!data.tps.has(key)) data.tps.set(key, tps);
		}
	}
	return data;
}
