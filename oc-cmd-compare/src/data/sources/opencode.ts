import { DOC_URL, OC_MODELS_URL, OC_PLANS } from "#~/constants/sources.ts";
import {
	extractCatalog,
	fetchText,
	parseTabTables,
} from "#~/data/scrape/index.ts";
import type { CatalogEntry, PlanInfo } from "#~/types.ts";

function planDef(planId: string) {
	const def = OC_PLANS[planId];
	if (!def) {
		throw new Error(
			`unknown OpenCode plan "${planId}" (have: ${Object.keys(OC_PLANS).join(", ")})`,
		);
	}
	return def;
}

/**
 * Per-model token rates + monthly usage limit for an OpenCode Go plan. Both
 * plans share one price list, so the tab label is what selects the right
 * allowance table: identical headers and rates, different monthly limits.
 */
export async function loadOcGoCatalog(
	planId: string,
	peak = false,
): Promise<CatalogEntry[]> {
	const def = planDef(planId);
	const html = await fetchText(DOC_URL);
	const tabs = await parseTabTables(html);
	const entries = extractCatalog(
		tabs.filter((tab) => tab.label === def.label).map((tab) => tab.table),
		{
			provider: "oc-go",
			plan: def.label,
			creditHeader: /monthly limit/i,
			peak,
		},
	);
	if (entries.length === 0) {
		throw new Error(
			`no model table parsed for the "${def.label}" plan from ${DOC_URL} — docs layout may have changed`,
		);
	}
	return entries;
}

/** A Go plan is flat-priced; limits are per-model, so there is no shared pool. */
export function ocGoPlan(entries: CatalogEntry[], planId: string): PlanInfo {
	const def = planDef(planId);
	return {
		provider: "oc-go",
		id: planId,
		label: def.label,
		price: def.price,
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
