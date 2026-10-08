import { describe, expect, test } from "bun:test";
import {
	costPerRequest,
	lookupAbility,
	lookupTps,
} from "~/cli/engine/index.ts";
import { SPEED_TPS_FACTOR } from "~/constants/scoring.ts";

describe("costPerRequest", () => {
	test("sums input, cache and output at per-million rates", () => {
		const cost = costPerRequest(
			{ input: 1, output: 1, cacheRead: 0, cacheWrite: null },
			{
				input: 1_000_000,
				cacheRead: 1_000_000,
				output: 1_000_000,
				reasoning: 0,
				cacheWrite: 0,
			},
		);
		expect(cost).toBeCloseTo(2, 10);
	});

	// GLM-5.3 at 1.4 / 4.4 / 0.26 $/M: 8,689 input, 14 output, 38 reasoning and
	// 128 cache-read tokens. The store priced this turn at 0.01242668 itself,
	// and only adding reasoning to the output term reproduces it exactly.
	const glm = { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: null };

	test("reasoning bills at the output rate on top of output", () => {
		const cost = costPerRequest(glm, {
			input: 8_689,
			cacheRead: 128,
			output: 14,
			reasoning: 38,
			cacheWrite: 0,
		});
		expect(cost).toBeCloseTo(0.01242668, 8);
	});

	test("an unpublished cache-write rate is not a free cache write", () => {
		const workload = {
			input: 0,
			cacheRead: 0,
			output: 0,
			reasoning: 0,
			cacheWrite: 1_000,
		};
		expect(costPerRequest(glm, workload)).toBeCloseTo(0.0014, 10);
		expect(costPerRequest({ ...glm, cacheWrite: 9 }, workload)).toBeCloseTo(
			0.009,
			10,
		);
	});
});

describe("lookupAbility", () => {
	const scores = new Map([
		["glm52", 33.7],
		["deepseekv4flash", 34.3],
		["kimik27code", 25.8],
		["glm53flash", 41.8],
		["glm53", 44.8],
	]);
	test("exact key wins", () => {
		expect(lookupAbility(scores, "glm52")).toBe(33.7);
	});
	test("speed variants inherit the base model ability", () => {
		expect(lookupAbility(scores, "glm52fast")).toBe(33.7);
		expect(lookupAbility(scores, "deepseekv4flashfast")).toBe(34.3);
		expect(lookupAbility(scores, "kimik27codehighspeed")).toBe(25.8);
	});
	test("flashx inherits the flash tier, not the base", () => {
		expect(lookupAbility(scores, "glm53flashx")).toBe(41.8);
	});
	test("no base means no score", () => {
		expect(lookupAbility(scores, "mimov26proultraspeed")).toBeNull();
	});
});

describe("lookupTps", () => {
	const tps = new Map([
		["glm53flash", 51],
		["deepseekv41flash", 216],
		["kimik27codehighspeed", 300],
	]);
	test("an exact figure wins", () => {
		expect(lookupTps(tps, "glm53flash")).toBe(51);
		expect(lookupTps(tps, "kimik27codehighspeed")).toBe(300);
	});
	test("a variant with no figure scales the base by SPEED_TPS_FACTOR", () => {
		expect(lookupTps(tps, "deepseekv41flashfast")).toBe(
			216 * SPEED_TPS_FACTOR,
		);
	});
	test("flashx multiplies the flash tier, not the base", () => {
		expect(lookupTps(tps, "glm53flashx")).toBe(51 * SPEED_TPS_FACTOR);
	});
	test("no base figure means no throughput", () => {
		expect(lookupTps(tps, "mimov26proultraspeed")).toBeNull();
	});
});
