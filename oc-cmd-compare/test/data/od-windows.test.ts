import { describe, expect, test } from "bun:test";
import { buildMetrics, buildRows } from "#~/cli/engine/index.ts";
import { loadOdCatalog, odPlan } from "#~/data/sources/od/index.ts";
import { renderJson } from "#~/view/render.ts";
import type { PlanInfo, SideId } from "#~/types.ts";
import { odPriced, workload } from "../unit/fixtures.ts";

const KEYS = ["DeepSeek V4.1 Flash", "GLM-5.3 Flash-X", "Muse Spark 1.3"];
const plans = (id: string): Map<SideId, PlanInfo> => new Map([["od", odPlan(id)]]);

describe("requests per window", () => {
	test("Flash and Eco get different per-window request counts on Go", () => {
		const entries = loadOdCatalog(
			"go",
			odPriced([KEYS[0] as string, "DeepSeek V4.1 Flash Eco"]),
		).entries;
		const [flash, eco] = buildMetrics(entries, plans("go"), { od: workload });
		expect(flash?.requestsPerMonth).toBeCloseTo(120 / (flash?.costPerRequest ?? 1), 6);
		expect(eco?.requestsPerMonth).toBeCloseTo(220 / (eco?.costPerRequest ?? 1), 6);
		// Same token rates, different caps: every window count must differ.
		expect(flash?.costPerRequest).toBeCloseTo(eco?.costPerRequest ?? -1, 6);
		expect(flash?.requestsPerFiveHour).not.toBeCloseTo(eco?.requestsPerFiveHour ?? -1, 2);
		expect(flash?.requestsPerWeek).not.toBeCloseTo(eco?.requestsPerWeek ?? -1, 2);
		expect(flash?.requestsPerFiveHour).toBeCloseTo(
			(flash?.requestsPerMonth ?? 0) * (10 / 120),
			6,
		);
		expect(eco?.requestsPerFiveHour).toBeCloseTo((eco?.requestsPerMonth ?? 0) * (18 / 220), 6);
	});

	test("Plus has no 5-hour window: 0 records the absence, the column prints a dash", () => {
		const entries = loadOdCatalog("plus", odPriced(KEYS)).entries.filter(
			(e) => e.key === "glm53flashx",
		);
		const [m] = buildMetrics(entries, plans("plus"), { od: workload });
		expect(m?.requestsPerFiveHour).toBe(0);
		expect(m?.requestsPerWeek).toBeCloseTo((m?.requestsPerMonth ?? 0) * (74 / 290), 6);
	});
});

describe("payload", () => {
	test("--od-plan rows carry the od block and the plan", () => {
		const loaded = loadOdCatalog("plus", odPriced(KEYS));
		const plan = odPlan("plus");
		const rows = buildRows(
			[],
			[],
			plan,
			plan,
			{ od: workload },
			undefined,
			undefined,
			undefined,
			{ entries: loaded.entries, plan },
		);
		const json = JSON.parse(
			renderJson(rows, {
				ocPlan: plan,
				ccPlan: plan,
				odPlan: plan,
				workloads: { od: workload },
			}),
		) as {
			plans: Record<string, { id: string; provider: string }>;
			rows: { od?: { allowance: number } }[];
		};
		expect(json.plans.od?.id).toBe("plus");
		expect(json.plans.od?.provider).toBe("od");
		expect(json.rows.every((r) => r.od !== undefined)).toBe(true);
	});
});
