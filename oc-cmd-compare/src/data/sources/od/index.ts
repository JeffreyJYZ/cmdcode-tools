import { allowanceAndCap } from "./caps.ts";
import { OD_MODELS } from "./models.ts";
import { planDef } from "./plans.ts";
import { odRate } from "./rates.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CatalogEntry, ModelPricing, PlanInfo, ProviderId } from "#~/types.ts";

export { capFor, odCapLines } from "./caps.ts";

/**
 * Last-resort rates from the other two catalogs, keyed by canonical key. Only
 * used when core/od.json has no row at all; every such price is flagged in
 * `crossPriced` so a foreign rate is never passed off as one Open Design
 * published. CC is preferred over OC, whose rows may be off-peak or tiered.
 */
function pricedKeys(priced: Record<ProviderId, CatalogEntry[]>): Map<string, ModelPricing> {
	const byKey = new Map<string, ModelPricing>();
	for (const entry of [...priced.cc, ...priced["oc-go"]]) {
		if (!byKey.has(entry.key)) byKey.set(entry.key, entry.pricing);
	}
	return byKey;
}

export interface OdLoad {
	entries: CatalogEntry[];
	/** Included in the plan but with no token rate to price it — never invented. */
	missing: string[];
	/** Priced, but the plan publishes no cap for it — absent, never a zero cap. */
	uncapped: string[];
	/** In the plan's model list but not this tier (Go carries no top models). */
	excluded: string[];
	/** Priced from another catalog because core/od.json has no row — never silent. */
	crossPriced: string[];
	/** Plan id the load was made for, so --check can name its cap table. */
	planId: string;
}

/**
 * Price each row from Open Design's own published list, carried in core/od.json
 * and keyed by the model's wire id. Rates and credit multiplier both come from
 * that row: cross-pricing silently understated DeepSeek V4.1 Flash by 2x. A row
 * with no published rate stays unpriced; another catalog is used only when
 * core/od.json has no row for the model at all, and is then flagged.
 */
export function loadOdCatalog(planId: string, priced: Record<ProviderId, CatalogEntry[]>): OdLoad {
	const def = planDef(planId);
	const fallback = pricedKeys(priced);
	const entries: CatalogEntry[] = [];
	const missing: string[] = [];
	const uncapped: string[] = [];
	const excluded: string[] = [];
	const crossPriced: string[] = [];
	for (const model of OD_MODELS) {
		if (model.plans && !model.plans.includes(planId)) {
			excluded.push(model.name);
			continue;
		}
		const row = odRate(model.id);
		let multiplier = model.multiplier; // fallback for a plan with no published row
		let pricing: ModelPricing | undefined;
		if (row) {
			// Published multiplier wins, including the open Haiku 5.5 conflict
			// (core/od.json is the declared source of truth). A registered row
			// with no published rate is never cross-priced.
			multiplier = row.multiplier;
			pricing = row.pricing ?? undefined;
		} else {
			pricing = fallback.get(normalizeKey(model.name));
			if (pricing) crossPriced.push(model.name);
		}
		if (!pricing) {
			missing.push(model.name);
			continue;
		}
		const { allowance, cap } = allowanceAndCap(model, planId, multiplier);
		if (allowance === null) {
			uncapped.push(model.name);
			continue;
		}
		entries.push({
			provider: "od",
			plan: def.label,
			key: normalizeKey(model.name),
			name: model.name,
			pricing,
			allowance,
			...(cap ? { cap } : {}),
		});
	}
	return { entries, missing, uncapped, excluded, crossPriced, planId };
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
