import {
	DOC_URL,
	OC_MODELS_URL,
	PRICE_PER_MONTH,
} from "#~/constants/sources.ts";
import {
	extractCatalog,
	fetchText,
	parseTables,
} from "#~/data/scrape/index.ts";
import type { CatalogEntry, PlanInfo } from "#~/types.ts";

/** Per-model token rates + monthly usage limit for OpenCode Go. */
export async function loadOcGoCatalog(peak = false): Promise<CatalogEntry[]> {
	const html = await fetchText(DOC_URL);
	const tables = await parseTables(html);
	const entries = extractCatalog(tables, {
		provider: "oc-go",
		plan: "Go",
		creditHeader: /monthly limit/i,
		peak,
	});
	if (entries.length === 0) {
		throw new Error(
			`no model table parsed from ${DOC_URL} — docs layout may have changed`,
		);
	}
	return entries;
}

/** OpenCode Go is a flat $10/mo; limits are per-model, so there is no shared pool. */
export function ocGoPlan(entries: CatalogEntry[]): PlanInfo {
	return {
		provider: "oc-go",
		id: "go",
		label: "Go",
		price: PRICE_PER_MONTH,
		credits: entries.reduce((sum, e) => sum + e.allowance, 0),
		fiveHour: null,
		weekly: null,
	};
}

/** Live model ids from the Go endpoint, for drift detection. */
export async function loadOcGoModelIds(): Promise<string[]> {
	const res = await fetch(OC_MODELS_URL, {
		headers: { "user-agent": "mpc/0.1 (+model price compare)" },
	});
	if (!res.ok) throw new Error(`GET ${OC_MODELS_URL} -> ${res.status}`);
	const body = (await res.json()) as { data?: { id: string }[] };
	return (body.data ?? []).map((m) => m.id);
}
