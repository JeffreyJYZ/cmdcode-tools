import { describe, expect, test } from "bun:test";
import { buildMetrics } from "#~/cli/engine/index.ts";
import { assignIndex } from "#~/cli/engine/score.ts";
import { DEFAULT_SCORE } from "#~/constants/scoring.ts";
import { ccPlan, entry, metric, workloads } from "../fixtures.ts";

describe("buildMetrics", () => {
	test("payPerRequest * requestsPerMonth equals plan price", () => {
		const [m] = buildMetrics(
			[entry({})],
			new Map([["cc", ccPlan]]),
			workloads,
		);
		expect(m?.requestsPerMonth).toBeGreaterThan(0);
		expect(
			(m?.payPerRequest ?? 0) * (m?.requestsPerMonth ?? 0),
		).toBeCloseTo(ccPlan.price, 6);
	});

	test("free models are infinite and score 100", () => {
		const free = entry({
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: null },
		});
		const [m] = buildMetrics([free], new Map([["cc", ccPlan]]), workloads);
		expect(m?.free).toBe(true);
		expect(m?.requestsPerMonth).toBe(Number.POSITIVE_INFINITY);
		expect(m?.index).toBe(100);
	});

	test("COST index is volume only: equal requests/mo ⇒ equal index, price fields ignored", () => {
		const high = metric(1);
		high.requestsPerMonth = 1_000;
		high.pricing = { input: 9, output: 99, cacheRead: 9, cacheWrite: null };
		const high2 = metric(1);
		high2.requestsPerMonth = 1_000;
		high2.pricing = {
			input: 0.001,
			output: 0.001,
			cacheRead: 0.001,
			cacheWrite: null,
		};
		const low = metric(1);
		low.requestsPerMonth = 1;
		const metrics = [high, high2, low];
		assignIndex(metrics);
		expect(high.index).toBe(high2.index);
		expect(high.index).toBe(100);
		expect(low.index).toBe(0);
	});

	test("index stays within 0..100", () => {
		const entries = [
			entry({
				key: "a",
				pricing: {
					input: 0.1,
					output: 0.2,
					cacheRead: 0.01,
					cacheWrite: null,
				},
			}),
			entry({
				key: "b",
				pricing: {
					input: 5,
					output: 30,
					cacheRead: 0.5,
					cacheWrite: null,
				},
			}),
		];
		for (const m of buildMetrics(
			entries,
			new Map([["cc", ccPlan]]),
			workloads,
		)) {
			expect(m.index).toBeGreaterThanOrEqual(0);
			expect(m.index).toBeLessThanOrEqual(100);
		}
	});
});

describe("ability value index", () => {
	test("VAL is set for scored models and null otherwise", () => {
		const price = { input: 1, output: 1, cacheRead: 0, cacheWrite: null };
		const entries = [
			entry({ key: "smart", pricing: price }),
			entry({ key: "dumb", pricing: price }),
			entry({ key: "unscored", pricing: price }),
		];
		const ability = new Map([
			["smart", 60],
			["dumb", 10],
		]);
		const metrics = buildMetrics(
			entries,
			new Map([["cc", ccPlan]]),
			workloads,
			ability,
			new Map(),
			{ ...DEFAULT_SCORE, abilityWeight: 0.4 },
		);
		const byKey = new Map(entries.map((e, i) => [e.key, metrics[i]]));
		expect(byKey.get("smart")?.ability).toBe(60);
		expect(byKey.get("smart")?.valueIndex).toBeGreaterThan(
			byKey.get("dumb")?.valueIndex ?? 0,
		);
		expect(byKey.get("unscored")?.ability).toBeNull();
		expect(byKey.get("unscored")?.valueIndex).toBeNull();
		for (const m of metrics) {
			if (m.valueIndex !== null) {
				expect(m.valueIndex).toBeGreaterThanOrEqual(0);
				expect(m.valueIndex).toBeLessThanOrEqual(100);
			}
		}
	});
});
