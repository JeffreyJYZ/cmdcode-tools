import { describe, expect, test } from "bun:test";
import mpcJson from "@/data/mpc.json";
import {
	compareRows,
	DASH,
	formatAbility,
	formatAllowance,
	formatCost,
	formatPerDollar,
	formatPerThousand,
	formatRate,
	formatRates,
	INFINITY,
	isMpcSnapshot,
	type MpcSide,
	type MpcSnapshot,
	requestsLabel,
	rowAbility,
	rowCost,
	rowDeal,
	rowTps,
	rowValue,
	rowWin,
	windowLabel,
} from "@/lib/mpc";
import {
	type MpcCandidate,
	type MpcRunner,
	type RawRun,
	selectSnapshot,
} from "../scripts/snapshot-mpc";

/** A priced, bounded side; override any field per test. */
function side(overrides: Partial<MpcSide> = {}): MpcSide {
	return {
		provider: "oc-go",
		plan: "Go",
		pricing: {
			input: 0.1,
			output: 0.2,
			cacheRead: 0.002,
			cacheWrite: null,
		},
		allowance: 20,
		requestsPerMonth: 1000,
		requestsPerFiveHour: 200,
		requestsPerWeek: 500,
		costPerRequest: 0.004,
		payPerRequest: 0.00002,
		multiplier: 3,
		ability: 40,
		tps: 100.4,
		index: 80,
		valueIndex: 90,
		free: false,
		...overrides,
	};
}

/** A raw mpc `--json` payload for the fall-through tests (no network). */
function rawRun(ccKey: string, ocKey: string): RawRun {
	return {
		plans: {
			"oc-go": {
				id: ocKey,
				label: ocKey === "go" ? "Go" : "Go Plus",
				price: ocKey === "go" ? 10 : 40,
				credits: ocKey === "go" ? 100 : 200,
				fiveHour: null,
				weekly: null,
			},
			cc: {
				id: ccKey,
				label: ccKey,
				price: 10,
				credits: 70,
				fiveHour: 14,
				weekly: 35,
			},
		},
		rows: [{ key: "gamma", name: "Gamma", oc: side(), cc: side() }],
		tally: {
			headToHead: 1,
			ocWins: 0,
			ccWins: 1,
			ties: 0,
			ocOnly: 0,
			ccOnly: 0,
		},
	};
}

const ROWS: MpcSnapshot["byPlan"][string][string]["rows"] = [
	// Unpriced on the CommandCode side: the whole `cc` side is null.
	{ key: "alpha", name: "Alpha", oc: side(), cc: null },
	// Free/unbounded on the CommandCode side: `requestsPerMonth` null.
	{
		key: "beta",
		name: "Beta",
		oc: side(),
		cc: side({ requestsPerMonth: null, free: true }),
	},
	// Fully priced on both sides.
	{ key: "gamma", name: "Gamma", oc: side(), cc: side() },
];

const snapshot: MpcSnapshot = {
	generatedAt: "2026-10-09T00:00:00.000Z",
	plans: [
		{
			key: "goat",
			label: "GOAT",
			price: 10,
			credits: 70,
			fiveHour: 14,
			weekly: 35,
		},
	],
	ocPlans: [
		{ key: "go", label: "Go", price: 10, credits: 20 },
		{ key: "go-plus", label: "Go Plus", price: 40, credits: 3690 },
	],
	byPlan: {
		goat: {
			go: { rows: ROWS },
			"go-plus": { rows: ROWS },
		},
	},
};

describe("compareRows — Review Focus 4", () => {
	test("a null side renders the placeholder, not NaN/undefined", () => {
		const [alpha] = compareRows(snapshot, "goat", "go");
		expect(alpha.cc).toBeNull();
		expect(alpha.ccLabel).toBe(DASH);
		expect(alpha.ccLabel).toBe("—");
	});

	test("a null requestsPerMonth renders as ∞, not 0/NaN", () => {
		const [, beta] = compareRows(snapshot, "goat", "go");
		expect(beta.cc?.requestsPerMonth).toBeNull();
		expect(beta.ccLabel).toBe(INFINITY);
		expect(beta.ccLabel).toBe("∞");
	});

	test("never emits NaN or undefined in any label", () => {
		for (const row of compareRows(snapshot, "goat", "go")) {
			for (const label of [row.ocLabel, row.ccLabel]) {
				expect(typeof label).toBe("string");
				expect(label).not.toBe("undefined");
				expect(label).not.toContain("NaN");
				expect(label.length).toBeGreaterThan(0);
			}
		}
	});

	test("a bounded side renders its count in mpc's K notation", () => {
		const [, , gamma] = compareRows(snapshot, "goat", "go");
		expect(gamma.ccLabel).toBe("1.0K");
		expect(gamma.ocLabel).toBe("1.0K");
	});

	test("the OC plan selects the row set; an unknown pair is empty", () => {
		expect(compareRows(snapshot, "goat", "go-plus")).toHaveLength(3);
		expect(compareRows(snapshot, "nope", "go")).toEqual([]);
		expect(compareRows(snapshot, "goat", "nope")).toEqual([]);
	});
});

describe("requestsLabel", () => {
	test("null and undefined both collapse to the placeholder", () => {
		expect(requestsLabel(null)).toBe("—");
		expect(requestsLabel(undefined)).toBe("—");
	});

	test("free side is ∞", () => {
		expect(requestsLabel(side({ requestsPerMonth: null }))).toBe(INFINITY);
		expect(requestsLabel(side({ requestsPerMonth: null }))).toBe("∞");
	});
});

describe("formatCost / formatAbility", () => {
	test("unpriced cost and unscored ability fall back to the placeholder", () => {
		expect(formatCost(null)).toBe("—");
		expect(formatCost(undefined)).toBe("—");
		expect(formatAbility(null)).toBe("—");
	});

	test("free cost is $0, small costs keep precision", () => {
		expect(formatCost(0)).toBe("$0");
		expect(formatCost(0.00022)).toBe("$0.00022");
	});

	test("ability is one decimal", () => {
		expect(formatAbility(48.1)).toBe("48.1");
	});
});

describe("mpc per-side columns", () => {
	test("rates render in/out/cache per 1M tokens", () => {
		expect(formatRates(side())).toBe("$0.1/$0.2/$0.002");
	});

	test("a side with no pricing (or no side) shows the dash", () => {
		const noPricing = side({
			pricing: undefined as unknown as MpcSide["pricing"],
		});
		expect(formatRates(noPricing)).toBe(DASH);
		expect(formatRates(null)).toBe(DASH);
	});

	test("allowance is a rate, `free` on a free model", () => {
		expect(formatAllowance(side())).toBe("$20");
		expect(formatAllowance(side({ free: true }))).toBe("free");
		expect(formatAllowance(null)).toBe(DASH);
	});

	test("window label distinguishes unpriced, free and bounded", () => {
		expect(windowLabel(null, 200)).toBe(DASH);
		expect(windowLabel(side(), null)).toBe(DASH);
		expect(windowLabel(side({ free: true }), null)).toBe(INFINITY);
		expect(windowLabel(side(), 200)).toBe("200");
		expect(windowLabel(side(), 54545.45)).toBe("54.5K");
	});

	test("$/1K is the pay-per-request figure scaled up", () => {
		expect(formatPerThousand(side())).toBe("$0.02");
		expect(formatPerThousand(null)).toBe(DASH);
	});

	test("req/$ is unlimited for free, else a short count", () => {
		expect(formatPerDollar(side())).toBe("50.0K");
		expect(formatPerDollar(side({ free: true }))).toBe("∞");
		expect(formatPerDollar(null)).toBe(DASH);
	});

	test("formatRate is `free` at zero, trims trailing zeros", () => {
		expect(formatRate(0)).toBe("free");
		expect(formatRate(0.1)).toBe("$0.1");
		expect(formatRate(undefined)).toBe(DASH);
	});
});

describe("mpc row-level columns", () => {
	test("WIN names the cheaper side, or the only side present", () => {
		expect(rowWin({ oc: side(), cc: null })).toBe("OC only");
		expect(rowWin({ oc: null, cc: side() })).toBe("CC only");
		expect(
			rowWin({
				oc: side({ payPerRequest: 0.00001 }),
				cc: side({ payPerRequest: 0.00002 }),
			}),
		).toBe("OC");
		expect(
			rowWin({
				oc: side({ payPerRequest: 0.00002 }),
				cc: side({ payPerRequest: 0.00001 }),
			}),
		).toBe("CC");
		expect(
			rowWin({
				oc: side({ payPerRequest: 0.00002 }),
				cc: side({ payPerRequest: 0.00002 }),
			}),
		).toBe("tie");
	});

	test("ability and tps fall back to the side that has a figure", () => {
		expect(
			rowAbility({
				oc: side({ ability: null }),
				cc: side({ ability: 48.1 }),
			}),
		).toBe("48.1");
		expect(rowAbility({ oc: side({ ability: null }), cc: null })).toBe(
			DASH,
		);
		expect(
			rowTps({ oc: side({ tps: null }), cc: side({ tps: 214.6 }) }),
		).toBe("215");
		expect(rowTps({ oc: side({ tps: null }), cc: null })).toBe(DASH);
	});

	test("DEAL is CommandCode's badge, else the dash", () => {
		expect(
			rowDeal({ oc: side(), cc: side({ deal: { badge: "-98%" } }) }),
		).toBe("-98%");
		expect(rowDeal({ oc: side(), cc: side() })).toBe(DASH);
	});

	test("COST inverts the best volume index", () => {
		expect(
			rowCost({ oc: side({ index: 80 }), cc: side({ index: 90 }) }),
		).toBe(10);
	});

	test("VAL takes the better score; null when neither side is scored", () => {
		expect(
			rowValue({
				oc: side({ valueIndex: 91 }),
				cc: side({ valueIndex: 55 }),
			}),
		).toBe(91);
		expect(
			rowValue({
				oc: side({ valueIndex: null }),
				cc: side({ valueIndex: 55 }),
			}),
		).toBe(55);
		expect(
			rowValue({ oc: side({ valueIndex: null }), cc: null }),
		).toBeNull();
	});

	test("a one-sided row never yields NaN/undefined for any column", () => {
		const row = { oc: side(), cc: null };
		const cells = [
			rowAbility(row),
			rowTps(row),
			rowDeal(row),
			rowWin(row),
			rowCost(row).toString(),
			rowValue(row)?.toString() ?? DASH,
		];
		for (const cell of cells) {
			expect(typeof cell).toBe("string");
			expect(cell).not.toContain("NaN");
			expect(cell).not.toBe("undefined");
		}
	});
});

describe("isMpcSnapshot — client adoption gate", () => {
	const committed = mpcJson as MpcSnapshot;

	test("accepts the committed snapshot", () => {
		expect(isMpcSnapshot(committed)).toBe(true);
	});

	test("rejects a slim-shaped side (the earlier snapshot shape)", () => {
		// The old side carried only these five fields; the widened formatters
		// read pricing/payPerRequest/index/…, so this must be refused rather
		// than adopted and rendered as `$NaN`/`∞`.
		const slimSide = {
			allowance: 20,
			requestsPerMonth: 1000,
			costPerRequest: 0.004,
			ability: 40,
			free: false,
		};
		const slim = {
			generatedAt: "2026-10-09T00:00:00.000Z",
			plans: [{ key: "goat", label: "GOAT" }],
			ocPlans: [],
			byPlan: {
				goat: {
					go: {
						rows: [{ key: "x", name: "X", oc: slimSide, cc: null }],
					},
				},
			},
		};
		expect(isMpcSnapshot(slim)).toBe(false);
	});

	test("rejects the previous flat shape (byPlan[cc] was a run)", () => {
		// A raw-CDN copy can still serve the flat snapshot for ~5 min after a
		// push. It carries `ocPlans` and a widened side but no nesting, so the
		// OC-plan switch would read `undefined` on every cell — refuse it.
		const flat = {
			generatedAt: "2026-10-09T00:00:00.000Z",
			plans: [{ key: "goat", label: "GOAT" }],
			ocPlans: [{ key: "go", label: "Go" }],
			byPlan: {
				goat: {
					rows: [{ key: "x", name: "X", oc: side(), cc: null }],
				},
			},
		};
		expect(isMpcSnapshot(flat)).toBe(false);
	});

	test("rejects a snapshot without the ocPlans dimension", () => {
		expect(
			isMpcSnapshot({
				generatedAt: "2026-10-09T00:00:00.000Z",
				plans: [],
				byPlan: { goat: { go: { rows: [] } } },
			}),
		).toBe(false);
	});

	test("rejects a side missing only the widened fields", () => {
		const stripped = { ...side() } as Record<string, unknown>;
		delete stripped.payPerRequest;
		const bad = {
			generatedAt: "2026-10-09T00:00:00.000Z",
			plans: [],
			ocPlans: [],
			byPlan: {
				goat: {
					go: {
						rows: [{ key: "x", name: "X", oc: stripped, cc: null }],
					},
				},
			},
		};
		expect(isMpcSnapshot(bad)).toBe(false);
	});

	test("still accepts rows with a null side", () => {
		const ok = {
			generatedAt: "2026-10-09T00:00:00.000Z",
			plans: [],
			ocPlans: [{ key: "go", label: "Go" }],
			byPlan: {
				goat: {
					go: { rows: [{ key: "x", name: "X", oc: null, cc: null }] },
				},
			},
		};
		expect(isMpcSnapshot(ok)).toBe(true);
	});
});

describe("snapshot plan dimensions", () => {
	const committed = mpcJson as MpcSnapshot;

	test("carries both OpenCode Go plans", () => {
		const keys = committed.ocPlans.map((p) => p.key);
		expect(keys).toContain("go");
		expect(keys).toContain("go-plus");
	});

	test("carries all 10 CommandCode × OpenCode Go pairs", () => {
		let pairs = 0;
		for (const cc of committed.plans) {
			for (const oc of committed.ocPlans) {
				const run = committed.byPlan[cc.key]?.[oc.key];
				expect(Array.isArray(run?.rows)).toBe(true);
				expect(run?.rows.length ?? 0).toBeGreaterThan(0);
				pairs += 1;
			}
		}
		expect(pairs).toBe(10);
	});
});

describe("snapshot-mpc — candidate fall-through", () => {
	test("falls through an auto candidate that fails to run", () => {
		const seen: string[] = [];
		const options: MpcCandidate[] = [
			{
				command: "/nope/broken",
				prefixArgs: [],
				label: "broken",
				explicit: false,
			},
			{
				command: "/nope/good",
				prefixArgs: [],
				label: "good",
				explicit: false,
			},
		];
		const run: MpcRunner = (candidate, ccKey, ocKey) => {
			seen.push(candidate.label);
			if (candidate.label === "broken") {
				throw new Error("unknown option '--oc-plan'");
			}
			return rawRun(ccKey, ocKey);
		};
		const { mpc, snapshot: built } = selectSnapshot(
			options,
			(candidate) => candidate,
			run,
		);
		expect(mpc.label).toBe("good");
		expect(seen).toContain("good");
		expect(built.byPlan.goat["go-plus"]?.rows).toHaveLength(1);
	});

	test("skips an auto candidate that does not resolve", () => {
		const options: MpcCandidate[] = [
			{
				command: "/nope/missing",
				prefixArgs: [],
				label: "missing",
				explicit: false,
			},
			{
				command: "/nope/good",
				prefixArgs: [],
				label: "good",
				explicit: false,
			},
		];
		const { mpc } = selectSnapshot(
			options,
			(candidate) => (candidate.label === "missing" ? null : candidate),
			(_candidate, ccKey, ocKey) => rawRun(ccKey, ocKey),
		);
		expect(mpc.label).toBe("good");
	});

	test("an explicit MPC_BIN that fails to run stays fatal", () => {
		const options: MpcCandidate[] = [
			{
				command: "/nope/bin",
				prefixArgs: [],
				label: "MPC_BIN",
				explicit: true,
			},
			{
				command: "/nope/good",
				prefixArgs: [],
				label: "good",
				explicit: false,
			},
		];
		expect(() =>
			selectSnapshot(
				options,
				(candidate) => candidate,
				() => {
					throw new Error("boom");
				},
			),
		).toThrow(/boom/);
	});

	test("an explicit MPC_BIN that does not resolve stays fatal", () => {
		const options: MpcCandidate[] = [
			{
				command: "/nope/bin",
				prefixArgs: [],
				label: "MPC_BIN",
				explicit: true,
			},
		];
		expect(() => selectSnapshot(options, () => null)).toThrow(/MPC_BIN/);
	});
});

describe("committed snapshot — every cell renders cleanly", () => {
	const snapshot = mpcJson as MpcSnapshot;

	/** The per-side string cells the Full view builds, plus the meta cells. */
	function cellsFor(s: MpcSide | null): string[] {
		return [
			formatRates(s),
			formatAllowance(s),
			windowLabel(s, s?.requestsPerFiveHour),
			windowLabel(s, s?.requestsPerWeek),
			requestsLabel(s),
			formatPerThousand(s),
			formatPerDollar(s),
		];
	}

	/** Every run in the nested snapshot, regardless of pair. */
	function allRuns() {
		return Object.values(snapshot.byPlan).flatMap((runs) =>
			Object.values(runs),
		);
	}

	test("no plan, row, side or meta cell emits NaN/undefined", () => {
		let checked = 0;
		for (const run of allRuns()) {
			for (const row of run.rows) {
				const cells = [
					...cellsFor(row.oc),
					...cellsFor(row.cc),
					rowAbility(row),
					rowTps(row),
					rowDeal(row),
					rowWin(row),
					rowCost(row).toString(),
					rowValue(row)?.toString() ?? DASH,
				];
				for (const cell of cells) {
					expect(cell).not.toContain("NaN");
					expect(cell).not.toBe("undefined");
					expect(cell.length).toBeGreaterThan(0);
					checked += 1;
				}
			}
		}
		expect(checked).toBeGreaterThan(0);
	});

	test("counts read in mpc's K/M notation, free models as ∞", () => {
		const labels = new Set<string>();
		for (const run of allRuns()) {
			for (const row of run.rows) {
				for (const s of [row.oc, row.cc]) {
					if (!s) continue;
					labels.add(requestsLabel(s));
					labels.add(windowLabel(s, s.requestsPerFiveHour));
				}
			}
		}
		let sawShort = false;
		for (const label of labels) {
			// Never the old locale-grouped form; only dash, ∞, or K/M/plain.
			expect(label).not.toContain(",");
			expect(label).toMatch(/^(—|∞|\d+(\.\d+)?[KM]?)$/);
			if (label.endsWith("K") || label.endsWith("M")) sawShort = true;
		}
		expect(sawShort).toBe(true);
	});

	test("the OC free models render their unbounded side as ∞", () => {
		for (const run of allRuns()) {
			for (const row of run.rows) {
				if (row.oc?.free) {
					expect(row.oc.requestsPerMonth).toBeNull();
					expect(requestsLabel(row.oc)).toBe(INFINITY);
				}
			}
		}
	});
});
