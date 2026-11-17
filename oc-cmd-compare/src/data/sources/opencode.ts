import { OC_MODELS_URL, OC_PLANS } from "#~/constants/sources.ts";
import { parseOcGoModels } from "#~/data/scrape/index.ts";
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
 * Per-model token rates + monthly usage limit for an OpenCode Go plan.
 *
 * The docs article no longer carries the priced tables (it now just links to
 * the console), and the console table has limits but no token prices. The
 * `/zen/go/v1/models` endpoint is the only live source with both; the plan's
 * `usageKey` selects its monthly-limit column. The API publishes one price
 * set, so `peak` is accepted for interface parity but has no effect.
 */
export async function loadOcGoCatalog(planId: string, _peak = false): Promise<CatalogEntry[]> {
	const def = planDef(planId);
	const res = await fetch(OC_MODELS_URL, {
		headers: { "user-agent": "mpc/0.1 (+model price compare)" },
	});
	if (!res.ok) throw new Error(`GET ${OC_MODELS_URL} -> ${res.status} ${res.statusText}`);
	const entries = parseOcGoModels(await res.json(), def);
	if (entries.length === 0) {
		throw new Error(`no model rows parsed from ${OC_MODELS_URL} — API shape may have changed`);
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
