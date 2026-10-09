import { describe, expect, test } from "bun:test";
import { entriesOf } from "#~/market/entries.ts";
import { customEntry, type MpcJson, planLabel } from "#~/market/rates.ts";

/** mpc's own payload, reduced to the fields this tool reads. */
export const MPC: MpcJson = {
	plans: {
		"oc-go": { label: "Go", credits: 60, fiveHour: null, weekly: null },
		cc: { label: "GOAT", credits: 70, fiveHour: 14, weekly: 35 },
	},
	rows: [
		{
			key: "kimik3",
			name: "Kimi K3",
			oc: {
				provider: "oc-go",
				plan: "Go",
				pricing: {
					input: 1,
					output: 2,
					cacheRead: 0.1,
					cacheWrite: null,
				},
				allowance: 60,
				requestsPerMonth: 1_000,
				requestsPerFiveHour: 200,
				requestsPerWeek: 500,
				free: false,
			},
			cc: {
				provider: "cc",
				plan: "GOAT",
				pricing: {
					input: 1,
					output: 2,
					cacheRead: 0.1,
					cacheWrite: null,
				},
				allowance: 20,
				requestsPerMonth: 500,
				requestsPerFiveHour: 100,
				requestsPerWeek: 250,
				free: false,
			},
		},
		{
			key: "freebie",
			name: "Freebie",
			cc: {
				provider: "cc",
				plan: "GOAT",
				pricing: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: null,
				},
				allowance: 20,
				free: true,
			},
		},
		{
			key: "unpriced",
			name: "Unpriced",
			cc: {
				provider: "cc",
				plan: "GOAT",
				pricing: null,
				allowance: null,
			},
		},
	],
};

describe("entriesOf", () => {
	test("reads both sides, their allowances and their plan labels", () => {
		const entries = entriesOf(MPC);
		expect(entries).toHaveLength(3);
		const oc = entries.find((item) => item.provider === "oc-go");
		expect(oc?.model).toBe("Kimi K3");
		expect(oc?.allowance).toBe(60);
		expect(oc && planLabel(oc)).toBe("OC Go");
		const cc = entries.find((item) => item.provider === "cc");
		expect(cc && planLabel(cc)).toBe("CC GOAT");
	});

	test("window ratios come from the plan block, or from a row when absent", () => {
		const entries = entriesOf(MPC);
		const oc = entries.find((item) => item.provider === "oc-go");
		// OpenCode Go publishes no caps in the plans block, so the ratio is read
		// back off a row where mpc already applied its own rule.
		expect(oc?.ratio5h).toBeCloseTo(0.2, 6);
		expect(oc?.ratioWeek).toBeCloseTo(0.5, 6);
		const cc = entries.find((item) => item.provider === "cc");
		expect(cc?.ratio5h).toBeCloseTo(14 / 70, 6);
		expect(cc?.ratioWeek).toBeCloseTo(35 / 70, 6);
	});

	test("a model with no pricing is skipped rather than priced at zero", () => {
		const entries = entriesOf(MPC);
		expect(entries.some((item) => item.model === "Unpriced")).toBe(false);
	});

	test("a model only one provider sells still becomes an entry", () => {
		const entries = entriesOf(MPC);
		expect(entries.find((item) => item.key === "freebie")?.provider).toBe(
			"cc",
		);
	});

	test("an empty payload is an empty catalogue, not a crash", () => {
		expect(entriesOf({})).toEqual([]);
		expect(entriesOf({ rows: [{ key: "x", name: "X" }] })).toEqual([]);
	});
});

describe("customEntry", () => {
	test("caps become ratios of the budget", () => {
		const custom = customEntry({
			label: "my model",
			input: 1,
			output: 2,
			cacheRead: 0.1,
			cacheWrite: null,
			budget: 60,
			cap5h: 12,
			capWeek: 30,
		});
		expect(planLabel(custom)).toBe("custom");
		expect(custom.ratio5h).toBeCloseTo(0.2, 6);
		expect(custom.ratioWeek).toBeCloseTo(0.5, 6);
	});

	test("without caps there are no window ratios to invent", () => {
		const custom = customEntry({
			label: "my model",
			input: 1,
			output: 2,
			cacheRead: null,
			cacheWrite: null,
			budget: 60,
			cap5h: null,
			capWeek: null,
		});
		expect(custom.ratio5h).toBeNull();
		expect(custom.ratioWeek).toBeNull();
	});
});
