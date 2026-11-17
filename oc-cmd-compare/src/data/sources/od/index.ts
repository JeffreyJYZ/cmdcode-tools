import { OD_MODELS, type OdModel } from "./models.ts";
import { OD_PLANS } from "./plans.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CapSet, CatalogEntry, ModelPricing, PlanInfo, ProviderId } from "#~/types.ts";

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
	/** Priced, but the plan publishes no cap for it — absent, never a zero cap. */
	uncapped: string[];
	/** In the plan's model list but not this tier (Go carries no top models). */
	excluded: string[];
	/** Plan id the load was made for, so --check can name its cap table. */
	planId: string;
}

/**
 * The cap set a coding model draws. Plans that publish per-model caps (Go,
 * Plus) resolve their own row, else `defaultCaps`; a plan with neither leaves
 * the model uncapped. Null for a top model — it draws Top Model Credits, which
 * have no windows, and is handled by the caller.
 */
export function capFor(model: OdModel, planId: string): CapSet | null {
	if (model.tier === "top") return null;
	const def = planDef(planId);
	return def.caps?.[normalizeKey(model.name)] ?? def.defaultCaps ?? null;
}

function allowanceAndCap(
	model: OdModel,
	planId: string,
): { allowance: number | null; cap: CapSet | null } {
	const def = planDef(planId);
	if (model.tier === "top") {
		// Top Model Credits are charged at model value, with no multiplier.
		return { allowance: def.top > 0 ? def.top : null, cap: null };
	}
	const cap = capFor(model, planId);
	if (cap) return { allowance: cap.month, cap };
	// Pro/Max publish one pool: keep the plan-credit ÷ multiplier projection.
	// A plan with neither per-model caps nor a pool publishes no allowance, so
	// the model stays absent rather than reading a fabricated zero.
	if (def.credits > 0) return { allowance: def.credits / model.multiplier, cap: null };
	return { allowance: null, cap: null };
}

/** One line per published cap set, plus the default, for `--check` to print. */
export function odCapLines(planId: string): string[] {
	const def = planDef(planId);
	const lines: string[] = [];
	const fmt = (name: string, c: CapSet): string =>
		`${name}: $${c.month}/mo · $${c.week}/wk · ${c.fiveHour === null ? "no 5h" : `$${c.fiveHour}/5h`}`;
	for (const [key, cap] of Object.entries(def.caps ?? {})) {
		lines.push(fmt(OD_MODELS.find((m) => normalizeKey(m.name) === key)?.name ?? key, cap));
	}
	if (def.defaultCaps) lines.push(fmt("default", def.defaultCaps));
	return lines;
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
	const uncapped: string[] = [];
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
		const { allowance, cap } = allowanceAndCap(model, planId);
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
	return { entries, missing, uncapped, excluded, planId };
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
