import { OD_MODELS, type OdModel } from "./models.ts";
import { planDef } from "./plans.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CapSet } from "#~/types.ts";

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

export function allowanceAndCap(
	model: OdModel,
	planId: string,
	multiplier: number,
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
	if (def.credits > 0) return { allowance: def.credits / multiplier, cap: null };
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
