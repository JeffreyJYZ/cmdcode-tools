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
 * those as `—` and `∞` (mpc's own convention), and every formatter falls back
 * to `—`, so the UI can never show `NaN`/`undefined` for a shape that passes
 * `isMpcSnapshot` (the client adoption gate).
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

/** A switchable OpenCode Go plan, lifted out of an mpc run's `plans["oc-go"]`. */
export type MpcOcPlanInfo = {
	key: string;
	label: string;
	price: number;
	credits: number;
};

export type MpcRun = {
	rows: MpcRow[];
	tally?: MpcTally;
};

/** One CommandCode plan's runs, keyed by OpenCode Go plan. */
export type MpcOcRuns = Record<string, MpcRun>;

/**
 * The committed snapshot: an mpc run for every CommandCode × OpenCode Go plan
 * pair (`byPlan[ccPlanKey][ocPlanKey]`). Both Go plans share token rates but
 * grant different per-model limits, so the OpenCode side is a real dimension.
 */
export type MpcSnapshot = {
	generatedAt: string;
	/** The CommandCode plans. */
	plans: MpcPlanInfo[];
	/** The OpenCode Go plans. */
	ocPlans: MpcOcPlanInfo[];
	byPlan: Record<string, MpcOcRuns>;
};

/** A row flattened for the comparison table — labels always defined. */
export type CompareRow = {
	key: string;
	name: string;
	oc: MpcSide | null;
	cc: MpcSide | null;
	/** OpenCode requests/month display: number, `∞`, or `—`. */
	ocLabel: string;
	/** CommandCode requests/month display: number, `∞`, or `—`. */
	ccLabel: string;
};

/** The pair of sides a row-level helper reads. */
export type Sides = Pick<CompareRow, "oc" | "cc">;

/**
 * True when a side carries every field the full-column formatters dereference
 * (`pricing`, `payPerRequest`, `index`, …). The old slim side had only
 * `allowance`/`requestsPerMonth`/`costPerRequest`/`ability`/`free`, so it fails
 * this and is rejected rather than rendered as `$NaN`. `null` is a valid value
 * for the bounded/unbounded fields; the key must still be present.
 */
function isMpcSide(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const s = value as Record<string, unknown>;
	return (
		typeof s.free === "boolean" &&
		typeof s.allowance === "number" &&
		typeof s.costPerRequest === "number" &&
		typeof s.payPerRequest === "number" &&
		typeof s.index === "number" &&
		typeof s.pricing === "object" &&
		s.pricing !== null &&
		"requestsPerMonth" in s &&
		"requestsPerFiveHour" in s &&
		"requestsPerWeek" in s &&
		"ability" in s &&
		"tps" in s &&
		"valueIndex" in s
	);
}

/** True for a single mpc run: a `rows` array of valid rows. */
function isMpcRun(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const rows = (value as Record<string, unknown>).rows;
	if (!Array.isArray(rows)) return false;
	for (const row of rows) {
		if (typeof row !== "object" || row === null) return false;
		const r = row as Record<string, unknown>;
		if (r.oc != null && !isMpcSide(r.oc)) return false;
		if (r.cc != null && !isMpcSide(r.cc)) return false;
	}
	return true;
}

/**
 * True only for a nested snapshot whose every present side carries the widened
 * fields the UI consumes, and whose `byPlan` is keyed CommandCode → OpenCode Go.
 * A `null` side (unpriced) is valid. Anything else is rejected, so the client
 * keeps the committed snapshot instead of rendering `$NaN`/`∞` from missing
 * fields. Two flat shapes are refused by name:
 *
 * - the **slim** snapshot (sides without `pricing`/`payPerRequest`/…), and
 * - the **previous flat** snapshot whose `byPlan[cc]` was a run itself rather
 *   than `{ go, go-plus }`. A cached raw-CDN copy can still serve that shape for
 *   ~5 min after a push, so it must not be adopted: the OC-plan switch would
 *   read `undefined` on every cell.
 */
export function isMpcSnapshot(value: unknown): value is MpcSnapshot {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.generatedAt !== "string" || !Array.isArray(v.plans)) {
		return false;
	}
	if (!Array.isArray(v.ocPlans)) return false;
	if (typeof v.byPlan !== "object" || v.byPlan === null) return false;
	for (const cc of Object.values(v.byPlan)) {
		if (typeof cc !== "object" || cc === null) return false;
		const runs = cc as Record<string, unknown>;
		// Reject the previous flat shape: `byPlan[cc]` used to be a run itself.
		if ("rows" in runs) return false;
		for (const run of Object.values(runs)) {
			if (!isMpcRun(run)) return false;
		}
	}
	return true;
}

export const DASH = "\u2014";
/** mpc's symbol for "unbounded requests" (a free model) and "unlimited req/$". */
export const INFINITY = "\u221E";

/**
 * Requests a rolling window allows for one side: `—` when the model is
 * unpriced there, `∞` when it is free (unbounded), otherwise mpc's K/M count.
 */
export function windowLabel(
	side: MpcSide | null | undefined,
	value: number | null | undefined,
): string {
	if (!side) return DASH;
	if (value === null || value === undefined) {
		return side.free ? INFINITY : DASH;
	}
	return formatShortCount(value);
}

/**
 * Requests/month display for one side: `—` when the model is unpriced there,
 * `∞` when it is free (unbounded), otherwise mpc's K/M count.
 */
export function requestsLabel(side: MpcSide | null | undefined): string {
	if (!side) return DASH;
	const value = side.requestsPerMonth;
	if (value === null || value === undefined) return INFINITY;
	return formatShortCount(value);
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
 * Every model in the chosen plan pair's run, flattened for the table. Unknown
 * keys yield an empty list — the page always has at least one of each plan, so
 * this is a guard, not a normal path.
 */
export function compareRows(
	snapshot: MpcSnapshot,
	ccPlanKey: string,
	ocPlanKey: string,
): CompareRow[] {
	const run = snapshot.byPlan[ccPlanKey]?.[ocPlanKey];
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
