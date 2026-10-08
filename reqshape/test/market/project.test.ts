import { describe, expect, test } from "bun:test";
import { project } from "~/market/project.ts";
import { customEntry, type RateEntry } from "~/market/rates.ts";
import type { Profile } from "~/types.ts";

const profile: Profile = {
	input: 1_000,
	output: 100,
	reasoning: 50,
	cacheRead: 2_000,
	cacheWrite: 10,
};

function entry(overrides: Partial<RateEntry> = {}): RateEntry {
	return {
		key: "k",
		model: "Kimi K3",
		provider: "cc",
		plan: "GOAT",
		input: 1,
		output: 2,
		cacheRead: 0.5,
		cacheWrite: null,
		allowance: 70,
		ratio5h: 0.2,
		ratioWeek: 0.5,
		free: false,
		...overrides,
	};
}

describe("project", () => {
	test("reasoning bills as output, and a missing rate falls back to input", () => {
		// (1000*1 + (100+50)*2 + 2000*0.5 + 10*1) / 1e6
		const result = project(entry(), profile);
		expect(result.costPerReq).toBeCloseTo(0.00231, 9);
		expect(result.cacheAtInput).toBe(false);
		// Cache write is null on most of the catalogue: billed, not assumed free.
		expect(result.writeAtInput).toBe(true);
	});

	test("a model with no cache-read rate pays input rates for the context", () => {
		// (1000*1 + 150*2 + 2000*1 + 10*1) / 1e6
		const result = project(entry({ cacheRead: null }), profile);
		expect(result.costPerReq).toBeCloseTo(0.00331, 9);
		expect(result.cacheAtInput).toBe(true);
	});

	test("a stated cache rate of zero is free caching, not a missing rate", () => {
		const result = project(entry({ cacheRead: 0 }), profile);
		expect(result.cacheAtInput).toBe(false);
		// (1000*1 + 150*2 + 2000*0 + 10*1) / 1e6
		expect(result.costPerReq).toBeCloseTo(0.00131, 9);
	});

	test("the allowance and the window caps divide one request's cost", () => {
		const result = project(entry(), profile);
		expect(result.requestsPerMonth).toBeCloseTo(70 / 0.00231, 3);
		expect(result.requestsPerFiveHour).toBeCloseTo((70 / 0.00231) * 0.2, 3);
		expect(result.requestsPerWeek).toBeCloseTo((70 / 0.00231) * 0.5, 3);
	});

	test("a free model buys unlimited requests and says so", () => {
		const free = entry({
			model: "Freebie",
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			allowance: 20,
			free: true,
		});
		const result = project(free, profile);
		expect(result.costPerReq).toBe(0);
		expect(result.requestsPerMonth).toBe(Number.POSITIVE_INFINITY);
		expect(result.requestsPerFiveHour).toBe(Number.POSITIVE_INFINITY);
	});

	test("a cache write of zero makes the missing write rate moot", () => {
		const result = project(entry(), { ...profile, cacheWrite: 0 });
		expect(result.writeAtInput).toBe(false);
	});

	test("a custom model without caps reports no window figures", () => {
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
		const result = project(custom, profile);
		expect(result.requestsPerMonth).toBeGreaterThan(0);
		expect(result.requestsPerFiveHour).toBeNull();
		expect(result.requestsPerWeek).toBeNull();
	});

	test("a heavier context costs more than a lighter one on the same model", () => {
		const light = project(entry(), profile);
		const heavy = project(entry(), { ...profile, cacheRead: 200_000 });
		expect(heavy.costPerReq).toBeGreaterThan(light.costPerReq);
		expect(heavy.requestsPerMonth).toBeLessThan(light.requestsPerMonth);
	});
});
