import type { CapSet } from "#~/types.ts";

export const OD_URL = "https://open-design.ai/pricing";

/**
 * One OpenDesign plan. Credits are USD: `credits` is the combined monthly
 * maximum (Coding Plan + Top Model), `coding` the Coding Plan part the 7-day and
 * 5-hour windows apply to, `top` the Top Model Credits (no window at all).
 * Numbers from open-design.ai/pricing and /model-credits, regular monthly price
 * — the intro and annual discounts are excluded on purpose.
 *
 * Go and Plus publish a DIFFERENT cap set per model class (Eco versus the
 * original Flash), so those sets live in `caps` keyed by canonical model key and
 * `defaultCaps` covers a coding model with no row of its own. Pro and Max
 * publish one set covering every Coding Plan model: they carry no `caps`, and
 * their allowance stays the plan's single credit pool ÷ the model's multiplier.
 * Every figure comes from docs/plan/opendesign/reference/od-caps.json.
 */
interface OdPlanDef {
	label: string;
	price: number;
	credits: number;
	coding: number;
	top: number;
	/** 5-hour Coding Plan cap; null when the plan has no 5-hour window. */
	fiveHour: number | null;
	weekly: number;
	concurrency: number;
	/** Published per-model cap sets, keyed by normalizeKey(model.name). */
	caps?: Record<string, CapSet>;
	/** Cap set for a coding model with no row in `caps`; absent means uncapped. */
	defaultCaps?: CapSet;
}

/** Fail loud on a plan id no cap table knows, naming the valid ids. */
export function planDef(planId: string): OdPlanDef {
	const def = OD_PLANS[planId];
	if (!def) {
		throw new Error(
			`unknown OpenDesign plan "${planId}" (have: ${Object.keys(OD_PLANS).join(", ")})`,
		);
	}
	return def;
}

export const OD_PLANS: Record<string, OdPlanDef> = {
	go: {
		label: "Go",
		price: 10,
		credits: 220,
		coding: 220,
		top: 0,
		fiveHour: 18,
		weekly: 55,
		concurrency: 10,
		caps: {
			deepseekv41flasheco: { month: 220, week: 55, fiveHour: 18 },
			deepseekv41flash: { month: 120, week: 30, fiveHour: 10 },
		},
		defaultCaps: { month: 220, week: 55, fiveHour: 18 },
	},
	plus: {
		label: "Plus",
		price: 20,
		credits: 310,
		coding: 290,
		top: 20,
		fiveHour: null,
		weekly: 74,
		concurrency: 20,
		caps: {
			deepseekv41flasheco: { month: 290, week: 74, fiveHour: null },
			deepseekv41flash: { month: 160, week: 40, fiveHour: null },
		},
		defaultCaps: { month: 290, week: 74, fiveHour: null },
	},
	pro: {
		label: "Pro",
		price: 100,
		credits: 480,
		coding: 360,
		top: 120,
		fiveHour: null,
		weekly: 90,
		concurrency: 30,
	},
	max: {
		label: "Max",
		price: 200,
		credits: 900,
		coding: 600,
		top: 300,
		fiveHour: null,
		weekly: 150,
		concurrency: 50,
	},
};
