/**
 * Types, display helpers and the row transform for the `/compare` page.
 *
 * Pure module — no filesystem, no network — so both the build-time snapshot
 * script and the client component can import it. The data itself is generated
 * by `scripts/snapshot-mpc.ts` into `src/data/mpc.json`.
 *
 * The display helpers mirror mpc's own column value functions
 * (`oc-cmd-compare/src/view/text/`), so `/compare` presents the same figures
 * mpc prints: `rates`, `allow`, `5h`/`wk`/`mo`, `$/1K`, `req/$`, `ability`,
 * `tps`, `DEAL`, `WIN`, `COST`, `VAL`. A side is `null` when the model is
 * unpriced in that plan, and a side's `requestsPerMonth` is `null` when the
 * model is free (unbounded requests) — never "missing". `requestsLabel` renders
 * those as `—` and `unbounded`, and every formatter falls back to `—`, so the
 * UI can never show `NaN`/`undefined`.
 */

export type MpcDeal = { badge: string };

/** Per-1M-token rates in USD; `cacheWrite` is null when the model has none. */
export type MpcPricing = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number | null;
};

/** One provider's projection for a model under the selected CommandCode plan. */
export type MpcSide = {
	provider: string;
	plan: string;
	pricing: MpcPricing;
	allowance: number;
	/** `null` = free/unbounded, not unknown. */
	requestsPerMonth: number | null;
	/** `null` = free/unbounded, not unknown. */
	requestsPerFiveHour: number | null;
	/** `null` = free/unbounded, not unknown. */
	requestsPerWeek: number | null;
	/** USD of list-rate spend for one request. */
	costPerRequest: number;
	/** What one request costs you on the plan. */
	payPerRequest: number;
	/** Allowance per dollar of subscription. */
	multiplier: number;
	ability: number | null;
	tps: number | null;
	/** 0-100 volume index, higher = more requests bought. */
	index: number;
	/** 0-100 ability-aware value, `null` when the model is unscored. */
	valueIndex: number | null;
	free: boolean;
	deal?: MpcDeal;
};

export type MpcRow = {
	key: string;
	name: string;
	oc: MpcSide | null;
	cc: MpcSide | null;
};

export type MpcTally = {
	headToHead: number;
	ocWins: number;
	ccWins: number;
	ties: number;
	ocOnly: number;
	ccOnly: number;
};

/** A switchable CommandCode plan, lifted out of an mpc run's `plans.cc`. */
export type MpcPlanInfo = {
	key: string;
	label: string;
	price: number;
	credits: number;
	fiveHour: number | null;
	weekly: number | null;
};

export type MpcRun = {
	rows: MpcRow[];
	tally?: MpcTally;
};

/** The committed snapshot: one mpc run per CommandCode plan. */
export type MpcSnapshot = {
	generatedAt: string;
	plans: MpcPlanInfo[];
	byPlan: Record<string, MpcRun>;
};

/** A row flattened for the comparison table — labels always defined. */
export type CompareRow = {
	key: string;
	name: string;
	oc: MpcSide | null;
	cc: MpcSide | null;
	/** OpenCode requests/month display: number, `unbounded`, or `—`. */
	ocLabel: string;
	/** CommandCode requests/month display: number, `unbounded`, or `—`. */
	ccLabel: string;
};

/** The pair of sides a row-level helper reads. */
export type Sides = Pick<CompareRow, "oc" | "cc">;

export const DASH = "\u2014";
export const UNBOUNDED = "unbounded";
/** mpc's symbol for "one dollar buys unlimited requests" (a free model). */
export const INFINITY = "\u221E";

/** Thousands-separated whole requests, e.g. `272,727`. */
export function formatCount(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

/**
 * Requests a rolling window allows for one side: `—` when the model is
 * unpriced there, `unbounded` when it is free, otherwise the grouped number.
 */
export function windowLabel(
	side: MpcSide | null | undefined,
	value: number | null | undefined,
): string {
	if (!side) return DASH;
	if (value === null || value === undefined) {
		return side.free ? UNBOUNDED : DASH;
	}
	return formatCount(value);
}

/**
 * Requests/month display for one side: `—` when the model is unpriced there,
 * `unbounded` when it is free, otherwise the grouped number.
 */
export function requestsLabel(side: MpcSide | null | undefined): string {
	if (!side) return DASH;
	const value = side.requestsPerMonth;
	if (value === null || value === undefined) return UNBOUNDED;
	return formatCount(value);
}

function trimZeros(s: string): string {
	return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Dollar-per-request display, e.g. `$0.00022`; `—` when unpriced. */
export function formatCost(n: number | null | undefined): string {
	if (n === null || n === undefined) return DASH;
	if (n === 0) return "$0";
	return `$${trimZeros(n.toFixed(n < 0.01 ? 6 : 4))}`;
}

/** Ability index to one decimal; `—` when unscored. */
export function formatAbility(n: number | null | undefined): string {
	return n === null || n === undefined ? DASH : n.toFixed(1);
}

/** mpc `fmtRate`: a token rate in $/M, `free` at zero, trimmed to 4dp. */
export function formatRate(n: number | null | undefined): string {
	if (n === null || n === undefined) return DASH;
	if (n === 0) return "free";
	return `$${Number(n.toFixed(4))}`;
}

/** mpc `fmtUsd`: fixed-point, trailing zeros trimmed, `free` at zero. */
export function formatUsd(n: number | null | undefined): string {
	if (n === null || n === undefined) return DASH;
	if (n === 0) return "free";
	const digits = n >= 0.01 ? 4 : n >= 1e-6 ? 8 : 11;
	return `$${n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** mpc `fmtCount`: one decimal for K/M, else rounded; `∞` for unbounded. */
export function formatShortCount(n: number): string {
	if (!Number.isFinite(n)) return INFINITY;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	if (n >= 10) return n.toFixed(0);
	return n.toFixed(1);
}

/** mpc `rates`: `in/out/cache` token prices per 1M tokens. */
export function formatRates(side: MpcSide | null | undefined): string {
	if (!side?.pricing) return DASH;
	const p = side.pricing;
	return `${formatRate(p.input)}/${formatRate(p.output)}/${formatRate(p.cacheRead)}`;
}

/** mpc `allow`: the monthly credits this plan gives the model. */
export function formatAllowance(side: MpcSide | null | undefined): string {
	if (!side) return DASH;
	return side.free ? "free" : formatRate(side.allowance);
}

/** mpc `$/1K`: plan-relative cost per 1,000 requests. */
export function formatPerThousand(side: MpcSide | null | undefined): string {
	if (!side) return DASH;
	return formatUsd(side.payPerRequest * 1000);
}

/** mpc `req/$`: requests one dollar of subscription buys on this model. */
export function formatPerDollar(side: MpcSide | null | undefined): string {
	if (!side) return DASH;
	if (side.free || side.payPerRequest === 0) return INFINITY;
	return formatShortCount(1 / side.payPerRequest);
}

/** mpc `ability`: the benchmark score, best of the two sides; `—` if unscored. */
export function rowAbility(row: Sides): string {
	return formatAbility(row.oc?.ability ?? row.cc?.ability ?? null);
}

/** mpc `tps`: output tokens/second, best of the two sides; `—` if unknown. */
export function rowTps(row: Sides): string {
	const tps = row.oc?.tps ?? row.cc?.tps ?? null;
	return tps === null ? DASH : Math.round(tps).toString();
}

/** mpc `DEAL`: CommandCode's promotion badge, or `—`. */
export function rowDeal(row: Sides): string {
	return row.cc?.deal?.badge ?? DASH;
}

/** Which side is cheaper per request on this row. */
export function cheaperSide(row: Sides): "oc" | "cc" | "tie" | "none" {
	if (!row.oc || !row.cc) return "none";
	if (row.oc.payPerRequest === row.cc.payPerRequest) return "tie";
	return row.oc.payPerRequest < row.cc.payPerRequest ? "oc" : "cc";
}

/** mpc `WIN`: the cheaper side, or the only side that carries the model. */
export function rowWin(row: Sides): string {
	if (!row.oc) return "CC only";
	if (!row.cc) return "OC only";
	const side = cheaperSide(row);
	if (side === "tie") return "tie";
	if (side === "none") return DASH;
	return side === "oc" ? "OC" : "CC";
}

/** mpc `COST`: inverted volume index — requests/month, lower is better. */
export function rowCost(row: Sides): number {
	const best = Math.max(row.oc?.index ?? -1, row.cc?.index ?? -1, 0);
	return 100 - best;
}

/** mpc `VAL`: the better ability-aware value score; `null` when unscored. */
export function rowValue(row: Sides): number | null {
	const scores = [row.oc?.valueIndex, row.cc?.valueIndex].filter(
		(value): value is number => typeof value === "number",
	);
	return scores.length === 0 ? null : Math.max(...scores);
}

/**
 * Every model in the chosen plan's run, flattened for the table. Unknown plan
 * keys yield an empty list — the page always has at least one plan, so this is
 * a guard, not a normal path.
 */
export function compareRows(
	snapshot: MpcSnapshot,
	planKey: string,
): CompareRow[] {
	const run = snapshot.byPlan[planKey];
	if (!run) return [];
	return run.rows.map((row) => ({
		key: row.key,
		name: row.name,
		oc: row.oc,
		cc: row.cc,
		ocLabel: requestsLabel(row.oc),
		ccLabel: requestsLabel(row.cc),
	}));
}
