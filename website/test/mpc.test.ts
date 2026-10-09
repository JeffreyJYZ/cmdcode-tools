import { describe, expect, test } from "bun:test";
import {
	compareRows,
	DASH,
	formatAbility,
	formatCost,
	type MpcSide,
	type MpcSnapshot,
	requestsLabel,
	UNBOUNDED,
} from "@/lib/mpc";

/** A priced, bounded side; override any field per test. */
function side(overrides: Partial<MpcSide> = {}): MpcSide {
	return {
		allowance: 20,
		requestsPerMonth: 1000,
		costPerRequest: 0.004,
		ability: 40,
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

	test("a null requestsPerMonth renders as unbounded, not 0/NaN", () => {
		const [, beta] = compareRows(snapshot, "goat");
		expect(beta.cc?.requestsPerMonth).toBeNull();
		expect(beta.ccLabel).toBe(UNBOUNDED);
		expect(beta.ccLabel).toBe("unbounded");
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

	test("a bounded side renders its count", () => {
		const [, , gamma] = compareRows(snapshot, "goat");
		expect(gamma.ccLabel).toBe("1,000");
		expect(gamma.ocLabel).toBe("1,000");
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

	test("free side is unbounded", () => {
		expect(requestsLabel(side({ requestsPerMonth: null }))).toBe(
			"unbounded",
		);
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
