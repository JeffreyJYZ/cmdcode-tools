/**
 * Types, display helpers and the row transform for the `/compare` page.
 *
 * Pure module — no filesystem, no network — so both the build-time snapshot
 * script and the client component can import it. The data itself is generated
 * by `scripts/snapshot-mpc.ts` into `src/data/mpc.json`.
 *
 * A side is `null` when the model is unpriced in that plan, and a side's
 * `requestsPerMonth` is `null` when the model is free (unbounded requests) —
 * never "missing". `requestsLabel` renders those as `—` and `unbounded`
 * respectively, so the UI can never show `NaN`/`undefined`.
 */

export type MpcDeal = { badge: string };

/** One provider's projection for a model under the selected CommandCode plan. */
export type MpcSide = {
	allowance: number;
	/** `null` = free/unbounded, not unknown. */
	requestsPerMonth: number | null;
	costPerRequest: number;
	ability: number | null;
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

export const DASH = "\u2014";
export const UNBOUNDED = "unbounded";

/** Thousands-separated whole requests, e.g. `272,727`. */
export function formatCount(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

/**
 * Requests/month display for one side: `—` when the model is unpriced there,
 * `unbounded` when it is free, otherwise the grouped number.
 */
export function requestsLabel(side: MpcSide | null | undefined): string {
	if (!side) return DASH;
	if (side.requestsPerMonth === null) return UNBOUNDED;
	return formatCount(side.requestsPerMonth);
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
