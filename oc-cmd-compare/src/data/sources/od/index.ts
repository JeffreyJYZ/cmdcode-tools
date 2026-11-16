import { OD_MODELS, type OdModel } from "./models.ts";
import { OD_PLANS } from "./plans.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CatalogEntry, ModelPricing, PlanInfo, ProviderId } from "#~/types.ts";

function planDef(planId: string) {
	const def = OD_PLANS[planId];
	if (!def) {
		throw new Error(
			`unknown OpenDesign plan "${planId}" (have: ${Object.keys(OD_PLANS).join(", ")})`,
		);
	}
	return def;
}

/** Per-model token rates to price an OpenDesign row with, keyed by canonical key. */
function pricedKeys(priced: Record<ProviderId, CatalogEntry[]>): Map<string, ModelPricing> {
	const byKey = new Map<string, ModelPricing>();
	// CommandCode's rates are the vendor list; an OpenCode row may be its
	// off-peak or tiered variant, so it is only the fallback.
	for (const entry of [...priced.cc, ...priced["oc-go"]]) {
		if (!byKey.has(entry.key)) byKey.set(entry.key, entry.pricing);
	}
	return byKey;
}

export interface OdLoad {
	entries: CatalogEntry[];
	/** Included in the plan but with no token rate to price it — never invented. */
	missing: string[];
	/** In the plan's model list but not this tier (Go carries no top models). */
	excluded: string[];
}

function allowanceOf(model: OdModel, planId: string): number {
	const def = planDef(planId);
	// Coding Plan rows can draw the whole combined maximum — Coding Plan credits
	// first, then any Top Model Credits — so that maximum is what one model can
	// spend. A top-model row draws its own top credits directly.
	const pool = model.tier === "coding" ? def.credits : def.top;
	return pool / model.multiplier;
}

/**
 * OpenDesign publishes credit multipliers and estimated request counts, not
 * per-model token rates. Rows are priced from the same model's catalog row on
 * the other two providers, and a model with no such row is reported rather than
 * given a made-up rate.
 */
export function loadOdCatalog(planId: string, priced: Record<ProviderId, CatalogEntry[]>): OdLoad {
	const def = planDef(planId);
	const rates = pricedKeys(priced);
	const entries: CatalogEntry[] = [];
	const missing: string[] = [];
	const excluded: string[] = [];
	for (const model of OD_MODELS) {
		if (model.plans && !model.plans.includes(planId)) {
			excluded.push(model.name);
			continue;
		}
		const pricing = rates.get(normalizeKey(model.priceKey ?? model.name));
		if (!pricing) {
			missing.push(model.name);
			continue;
		}
		entries.push({
			provider: "od",
			plan: def.label,
			key: normalizeKey(model.name),
			name: model.name,
			pricing,
			allowance: allowanceOf(model, planId),
		});
	}
	return { entries, missing, excluded };
}

/** Plan price + its own credit windows; windows apply to Coding Plan credits only. */
export function odPlan(planId: string): PlanInfo {
	const def = planDef(planId);
	return {
		provider: "od",
		id: planId,
		label: def.label,
		price: def.price,
		credits: def.credits,
		fiveHour: def.fiveHour,
		weekly: def.weekly,
	};
}
