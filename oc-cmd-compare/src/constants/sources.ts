interface CcPlanDef {
	/** cmduse plan name. */
	cmduse: string;
	label: string;
	/** Docs page slug under /docs/plans/. */
	slug: string;
	/** Allowance column header; omitted when the page publishes no credits column. */
	creditHeader?: RegExp;
	/**
	 * Allowance for models the docs list without an explicit credits row.
	 * GOAT/Pro: the standard 2x rate ($20 / $30). Go: the whole $10 plan pool,
	 * since Go publishes no per-model allowances.
	 */
	standardAllowance?: number;
	/** Parse the model list from a `role="row"` div grid instead of <table>. */
	grid?: boolean;
}

export const CC_PLANS: Record<string, CcPlanDef> = {
	go: {
		cmduse: "Go",
		label: "Go",
		slug: "go",
		standardAllowance: 10,
	},
	goat: {
		cmduse: "GOAT",
		label: "GOAT",
		slug: "goat",
		creditHeader: /monthly credit/i,
		standardAllowance: 20,
	},
	pro: {
		cmduse: "Pro",
		label: "Pro",
		slug: "pro",
		creditHeader: /monthly credit/i,
		standardAllowance: 30,
	},
	max10: {
		cmduse: "Max 10x",
		label: "Max 10x",
		slug: "max",
		creditHeader: /max\s*10/i,
	},
	max20: {
		cmduse: "Max 20x",
		label: "Max 20x",
		slug: "max",
		creditHeader: /max\s*20/i,
	},
};

/** One OpenCode Go plan: a docs tab label and its monthly subscription price. */
interface OcPlanDef {
	/** Docs tab label; the discriminator between the two plans' tables. */
	label: string;
	/** Subscription USD per month. */
	price: number;
}

const GO_PRICE_PER_MONTH = 10;
const GO_PLUS_PRICE_PER_MONTH = 40;

/**
 * OpenCode Go has two plans sharing one token price list but granting each
 * model a different monthly limit. The docs put each plan's allowance table in
 * a `<TabItem label="…">`; the tab label is what tells the otherwise identical
 * tables apart, so it doubles as the plan's identity here.
 */
export const OC_PLANS: Record<string, OcPlanDef> = {
	go: { label: "Go", price: GO_PRICE_PER_MONTH },
	"go-plus": { label: "Go Plus", price: GO_PLUS_PRICE_PER_MONTH },
};

/** The Go plan used when `--oc-plan` is not given. */
export const DEFAULT_OC_PLAN = "go";

export const DOC_URL = "https://opencode.ai/docs/go/";
export const OC_MODELS_URL = "https://opencode.ai/zen/go/v1/models";

export const API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
export const AA_MODELS_URL = "https://artificialanalysis.ai/models";

// CommandCode only publishes Intelligence and Tok/s on the GOAT/Pro catalogs.
export const PAGES = [
	"https://commandcode.ai/docs/plans/goat",
	"https://commandcode.ai/docs/plans/pro",
];
export const TPS_HEADER = /tok\s*\/?\s*s|tokens?\s*per\s*sec/i;

/** How long a cached benchmark result is considered fresh, in milliseconds. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
