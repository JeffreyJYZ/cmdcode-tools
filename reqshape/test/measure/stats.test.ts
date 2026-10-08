import { describe, expect, test } from "bun:test";
import { stats } from "~/measure/stats.ts";

describe("stats", () => {
	test("reports the mean, the nearest-rank percentiles and the max", () => {
		const result = stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(result.mean).toBe(5.5);
		expect(result.p10).toBe(1);
		expect(result.p50).toBe(5);
		expect(result.p90).toBe(9);
		expect(result.max).toBe(10);
	});

	test("an empty sample is zeros, not NaN", () => {
		expect(stats([])).toEqual({ mean: 0, p10: 0, p50: 0, p90: 0, max: 0 });
	});

	test("a single value is every percentile", () => {
		expect(stats([42])).toEqual({
			mean: 42,
			p10: 42,
			p50: 42,
			p90: 42,
			max: 42,
		});
	});
});
