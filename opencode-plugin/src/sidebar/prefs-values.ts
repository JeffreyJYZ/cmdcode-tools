// Stored value -> typed preference. One home for the coercion rules, so "what
// does the file accept" is answered in a single place and `prefs.ts` keeps to
// the interface and the file I/O.
//
// Nothing here throws: a missing, unreadable or malformed value leaves the
// default standing, and a value the settings dialog could not produce warns and
// falls back rather than crashing a streaming session.
import {
	COST_MODE_DEFAULT,
	COST_MODES,
	type CostMode,
	OC_PLAN_DEFAULT,
	OC_PLANS,
	type OcPlan,
	OD_PLAN_DEFAULT,
	OD_PLANS,
	type OdPlan,
} from "../constants/sidebar";

/** A plan id is only accepted verbatim; anything else asks for the default. */
export function planFrom(value: unknown, source: string): OcPlan | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (OC_PLANS as readonly string[]).includes(value)) {
		return value as OcPlan;
	}
	// Never crash or blank the panel over a typo: warn and use the default.
	console.warn(
		`[command-code] ignoring unknown OpenCode plan ${JSON.stringify(value)} (${source}); using "${OC_PLAN_DEFAULT}"`,
	);
	return undefined;
}

/** The OpenDesign plan, validated against the ids `oduse --plan` accepts. */
export function odPlanFrom(value: unknown, source: string): OdPlan | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (OD_PLANS as readonly string[]).includes(value)) {
		return value as OdPlan;
	}
	console.warn(
		`[command-code] ignoring unknown OpenDesign plan ${JSON.stringify(value)} (${source}); using "${OD_PLAN_DEFAULT}"`,
	);
	return undefined;
}

/**
 * A numeric setting only ever takes a value the settings dialog can produce,
 * so a hand-edited file cannot pick a 1ms poll or a 0ms re-scan.
 */
export function numberFrom(
	value: unknown,
	choices: readonly number[],
	fallback: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	if (typeof value === "number" && choices.includes(value)) return value;
	console.warn(
		`[command-code] ignoring unknown ${name} ${JSON.stringify(value)}; using ${fallback}`,
	);
	return fallback;
}

/** A boolean setting takes a real boolean, or the default with a warning: a
 *  hand-written `"od": "no"` must not be read as "on" without saying so. */
export function boolFrom(value: unknown, fallback: boolean, name: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	console.warn(
		`[command-code] ignoring non-boolean ${name} ${JSON.stringify(value)}; using ${fallback}`,
	);
	return fallback;
}

export function costFrom(value: unknown): CostMode {
	if (value === undefined) return COST_MODE_DEFAULT;
	if (typeof value === "string" && (COST_MODES as readonly string[]).includes(value)) {
		return value as CostMode;
	}
	console.warn(
		`[command-code] ignoring unknown cost mode ${JSON.stringify(value)}; using "${COST_MODE_DEFAULT}"`,
	);
	return COST_MODE_DEFAULT;
}
