export const OD_URL = "https://open-design.ai/pricing";

/**
 * One OpenDesign plan. Credits are USD: `credits` is the combined monthly
 * maximum (Coding Plan + Top Model), `coding` the Coding Plan part the 7-day and
 * 5-hour windows apply to, `top` the Top Model Credits (no window at all).
 * Numbers from open-design.ai/pricing and /model-credits, regular monthly price
 * — the intro and annual discounts are excluded on purpose.
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
