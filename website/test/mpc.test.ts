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
	byPlan: {
		goat: {
			rows: [
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
			],
		},
	},
};

describe("compareRows — Review Focus 4", () => {
	test("a null side renders the placeholder, not NaN/undefined", () => {
		const [alpha] = compareRows(snapshot, "goat");
		expect(alpha.cc).toBeNull();
		expect(alpha.ccLabel).toBe(DASH);
		expect(alpha.ccLabel).toBe("—");
	});

	test("a null requestsPerMonth renders as ∞, not 0/NaN", () => {
		const [, beta] = compareRows(snapshot, "goat");
		expect(beta.cc?.requestsPerMonth).toBeNull();
		expect(beta.ccLabel).toBe(INFINITY);
		expect(beta.ccLabel).toBe("∞");
	});

	test("never emits NaN or undefined in any label", () => {
		for (const row of compareRows(snapshot, "goat")) {
			for (const label of [row.ocLabel, row.ccLabel]) {
				expect(typeof label).toBe("string");
				expect(label).not.toBe("undefined");
				expect(label).not.toContain("NaN");
				expect(label.length).toBeGreaterThan(0);
			}
		}
	});

	test("a bounded side renders its count in mpc's K notation", () => {
		const [, , gamma] = compareRows(snapshot, "goat");
		expect(gamma.ccLabel).toBe("1.0K");
		expect(gamma.ocLabel).toBe("1.0K");
	});

	test("an unknown plan key yields an empty list", () => {
		expect(compareRows(snapshot, "nope")).toEqual([]);
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

	test("rejects a slim-shaped side (the previous snapshot shape)", () => {
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
			byPlan: {
				goat: {
					rows: [{ key: "x", name: "X", oc: slimSide, cc: null }],
				},
			},
		};
		expect(isMpcSnapshot(slim)).toBe(false);
	});

	test("rejects a side missing only the widened fields", () => {
		const stripped = { ...side() } as Record<string, unknown>;
		delete stripped.payPerRequest;
		const bad = {
			generatedAt: "2026-10-09T00:00:00.000Z",
			plans: [],
			byPlan: {
				goat: {
					rows: [{ key: "x", name: "X", oc: stripped, cc: null }],
				},
			},
		};
		expect(isMpcSnapshot(bad)).toBe(false);
	});

	test("still accepts rows with a null side", () => {
		const ok = {
			generatedAt: "2026-10-09T00:00:00.000Z",
			plans: [],
			byPlan: {
				goat: { rows: [{ key: "x", name: "X", oc: null, cc: null }] },
			},
		};
		expect(isMpcSnapshot(ok)).toBe(true);
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

	test("no plan, row, side or meta cell emits NaN/undefined", () => {
		let checked = 0;
		for (const run of Object.values(snapshot.byPlan)) {
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
		for (const run of Object.values(snapshot.byPlan)) {
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
});
