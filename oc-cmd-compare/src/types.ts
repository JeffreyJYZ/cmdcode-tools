export type ProviderId = "oc-go" | "cc";

/** Per-1M-token rates in USD. */
export interface ModelPricing {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number | null;
}

/** One model's pricing + monthly credit allowance on one provider's plan. */
export interface CatalogEntry {
	provider: ProviderId;
	plan: string;
	/** Canonical cross-provider key (see normalize.ts). */
	key: string;
	/** Human display name. */
	name: string;
	pricing: ModelPricing;
	/** Monthly credits ($) this plan devotes to this model. */
	allowance: number;
	/** Promotion CommandCode attaches to the row, when one is running. */
	deal?: Deal;
}

/** A promotion chip on a model row: "-40%", "Free", "2x usage". */
export interface Deal {
	badge: string;
	/** The expiry line the page prints beside it, verbatim. */
	ends?: string;
}

export interface PlanInfo {
	provider: ProviderId;
	/** CLI id, e.g. "goat". */
	id: string;
	label: string;
	/** Subscription USD per month. */
	price: number;
	/** Total monthly credits ($). */
	credits: number;
	fiveHour: number | null;
	weekly: number | null;
}

/** Fixed per-request token counts used for every model on both providers. */
export interface Workload {
	input: number;
	cacheRead: number;
	output: number;
	/** Reasoning tokens, billed at the output rate on top of `output`. */
	reasoning: number;
	/** Cache-write tokens, billed at the model's cache-write rate. */
	cacheWrite: number;
}

export interface EntryMetrics {
	provider: ProviderId;
	plan: string;
	pricing: ModelPricing;
	allowance: number;
	/** USD of list-rate spend for one request. */
	costPerRequest: number;
	/** Requests a month fits in this model's allowance. Infinity when free. */
	requestsPerMonth: number;
	/** Requests the plan's 5-hour window allows for this model. */
	requestsPerFiveHour: number;
	/** Requests the plan's weekly window allows for this model. */
	requestsPerWeek: number;
	/** What one request actually costs you on the plan. */
	payPerRequest: number;
	/** Allowance per dollar of subscription — "$usage per $paid". */
	multiplier: number;
	/** Benchmark score for the model, or null when unscored. */
	ability: number | null;
	/** Output tokens per second, or null when unknown. */
	tps: number | null;
	/** Promotion this entry's provider is running on the model, if any. */
	deal?: Deal;
	/** 0-100 blended value score, higher is better. */
	index: number;
	/** 0-100 ability-aware value score, null when the model is unscored. */
	valueIndex: number | null;
	free: boolean;
}

export interface CompareRow {
	key: string;
	name: string;
	oc?: EntryMetrics;
	cc?: EntryMetrics;
}
