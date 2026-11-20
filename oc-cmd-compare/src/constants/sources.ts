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

/** One OpenCode Go plan: a display label, its monthly price and its JSON key. */
interface OcPlanDef {
	/** Display label in the comparison table. */
	label: string;
	/** Subscription USD per month. */
	price: number;
	/** Key in `/zen/go/v1/models` → `go.monthly_usage`, the per-model allowance. */
	usageKey: "go" | "go-plus";
}

const GO_PRICE_PER_MONTH = 10;
const GO_PLUS_PRICE_PER_MONTH = 40;

/**
 * OpenCode Go has two plans sharing one token price list but granting each
 * model a different monthly limit. Both come from `/zen/go/v1/models`
 * (`cost.text` for rates, `go.monthly_usage[usageKey]` for the allowance);
 * `usageKey` is what tells the otherwise identical price lists apart.
 */
export const OC_PLANS: Record<string, OcPlanDef> = {
	go: { label: "Go", price: GO_PRICE_PER_MONTH, usageKey: "go" },
	"go-plus": {
		label: "Go Plus",
		price: GO_PLUS_PRICE_PER_MONTH,
		usageKey: "go-plus",
	},
};

/** The Go plan used when `--oc-plan` is not given. */
export const DEFAULT_OC_PLAN = "go";

/** The docs article. It no longer carries the catalog; see `OC_MODELS_URL`. */
export const DOC_URL = "https://opencode.ai/docs/console/go/";
/** Authoritative Go model list: per-1M token rates + per-plan monthly usage. */
export const OC_MODELS_URL = "https://opencode.ai/zen/go/v1/models";

/** Artificial Analysis retired `/api/v2/data/*` on 2026-11-04 (410 Gone). The free
 * tier serves the same index and median output speed mpc reads, so no Pro plan
 * is needed; the paid list at `/api/v2/language/models` answers 403 without one. */
export const API_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
export const AA_MODELS_URL = "https://artificialanalysis.ai/models";
/** Keyless leaderboard: the richest AA surface (far more rows than /models). */
export const AA_LEADERBOARD_URL = "https://artificialanalysis.ai/leaderboards/models";

// CommandCode only publishes Intelligence and Tok/s on the GOAT/Pro catalogs.
export const PAGES = [
	"https://commandcode.ai/docs/plans/goat",
	"https://commandcode.ai/docs/plans/pro",
];
export const TPS_HEADER = /tok\s*\/?\s*s|tokens?\s*per\s*sec/i;
