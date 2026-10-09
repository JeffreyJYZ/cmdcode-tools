import { describe, expect, test } from "bun:test";
import { project } from "#~/cli/engine/project.ts";
import type { UsageEntry } from "#~/data/usage/index.ts";
import { headToHead } from "#~/view/layout/usage.ts";
import { ccPlan, entry, ocPlan } from "../fixtures.ts";

const usage: UsageEntry = {
	key: "m",
	name: "M",
	requests: 100,
	tokensIn: 10_000_000,
	cacheRead: 0,
	cacheWrite: 0,
	tokensOut: 0,
	reasoning: 0,
	costUsd: 0,
};

describe("project", () => {
	test("derives per-request cost and plan-relative monthly", () => {
		const ocEntry = entry({
			provider: "oc-go",
			plan: "Go",
			key: "m",
			allowance: 20,
		});
		const ccEntry = entry({
			provider: "cc",
			plan: "GOAT",
			key: "m",
			allowance: 10,
		});
		const result = project(
			[usage],
			{ "oc-go": [ocEntry], cc: [ccEntry] },
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 1 },
		);
		const row = result.rows[0];
		// 10M input at $1/M = $10 period cost, 100 requests -> $0.10 each.
		expect(row?.cc?.costPerRequest).toBeCloseTo(0.1, 6);
		// $10 plan price over a $10 allowance -> $0.10 per request.
		expect(row?.cc?.payPerRequest).toBeCloseTo(0.1, 6);
		expect(row?.cc?.monthly).toBeCloseTo(10, 6);
		// allowance 10 vs 10 drawn -> right at the cap, not over.
		expect(row?.cc?.overCap).toBe(false);
		expect(row?.cc?.creditsDrawn).toBeCloseTo(10, 6);
	});

	test("bills reasoning at output and unpublished cache-write at input", () => {
		// The fixed-workload rule (cost.ts) must hold here too: reasoning joins
		// the output term, and a model with no cache-write rate bills writes at
		// its input rate rather than at zero.
		const priced = entry({
			provider: "cc",
			plan: "GOAT",
			key: "m",
			allowance: 10,
			pricing: { input: 1, output: 4, cacheRead: 0, cacheWrite: null },
		});
		const result = project(
			[
				{
					...usage,
					tokensIn: 0,
					tokensOut: 0,
					reasoning: 1_000_000,
					cacheWrite: 1_000_000,
				},
			],
			{ "oc-go": [], cc: [priced] },
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 1 },
		);
		// 1M reasoning at $4/M = $4, plus 1M cache-write at the $1/M input
		// rate = $1; over 100 requests that is $0.05 each.
		expect(result.rows[0]?.cc?.costPerRequest).toBeCloseTo(0.05, 6);
	});

	test("flags over-cap usage and scales by months", () => {
		const onlySmall = entry({
			provider: "cc",
			plan: "GOAT",
			key: "m",
			allowance: 5,
		});
		const result = project(
			[usage],
			{ "oc-go": [], cc: [onlySmall] },
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 1 },
		);
		expect(result.rows[0]?.cc?.overCap).toBe(true);
		const twoMonths = project(
			[usage],
			{ "oc-go": [], cc: [onlySmall] },
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 2 },
		);
		expect(twoMonths.ccMonthly).toBeCloseTo(result.ccMonthly / 2, 6);
	});

	test("reports unmatched models instead of dropping silently", () => {
		const result = project(
			[{ ...usage, key: "nope", name: "Ghost" }],
			{ "oc-go": [], cc: [] },
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 1 },
		);
		expect(result.unmatched).toEqual(["Ghost"]);
		expect(result.rows).toHaveLength(0);
	});
});

describe("headToHead", () => {
	const both: UsageEntry = { ...usage, key: "both", name: "Both" };
	const ccOnly: UsageEntry = { ...usage, key: "cconly", name: "CC Only" };

	test("compares only the models both plans price", () => {
		const result = project(
			[both, ccOnly],
			{
				"oc-go": [
					entry({
						provider: "oc-go",
						plan: "Go",
						key: "both",
						allowance: 20,
					}),
				],
				cc: [
					entry({
						provider: "cc",
						plan: "GOAT",
						key: "both",
						allowance: 10,
					}),
					entry({
						provider: "cc",
						plan: "GOAT",
						key: "cconly",
						allowance: 10,
					}),
				],
			},
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 1 },
		);
		const head = headToHead(result.rows);
		const shared = result.rows.find((row) => row.oc && row.cc);
		expect(head.total).toBe(2);
		expect(head.shared).toBe(1);
		// The verdict is the shared row alone; the CC-only figure must not reach it.
		expect(head.cc).toBeCloseTo(shared?.cc?.monthly ?? -1, 10);
		expect(head.oc).toBeCloseTo(shared?.oc?.monthly ?? -1, 10);
		// The per-side total does count it, which is exactly the artefact avoided.
		expect(result.ccMonthly).toBeGreaterThan(head.cc);
	});

	test("no overlap is not a win for either side", () => {
		const result = project(
			[ccOnly],
			{
				"oc-go": [],
				cc: [entry({ provider: "cc", plan: "GOAT", key: "cconly" })],
			},
			{ "oc-go": ocPlan, cc: ccPlan },
			{ months: 1 },
		);
		const head = headToHead(result.rows);
		expect(head.shared).toBe(0);
		expect(head.winner).toBe("none");
	});
});
