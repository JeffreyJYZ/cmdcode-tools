import { describe, expect, test } from "bun:test";
import { buildMetrics, buildRows } from "#~/cli/engine/index.ts";
import { OD_MODELS } from "#~/data/sources/od/models.ts";
import { OD_PLANS } from "#~/data/sources/od/plans.ts";
import { loadOdCatalog, odPlan } from "#~/data/sources/od/index.ts";
import { normalizeKey } from "#~/keys.ts";
import { renderJson } from "#~/view/render.ts";
import type { CatalogEntry, PlanInfo, ProviderId, SideId } from "#~/types.ts";
import { entry, workload } from "../unit/fixtures.ts";

/** A stand-in catalog that only carries the rows these tests ask for. */
function priced(keys: string[]): Record<ProviderId, CatalogEntry[]> {
	return {
		"oc-go": [],
		cc: keys.map((name) => entry({ key: normalizeKey(name), name })),
	};
}

const KEYS = ["DeepSeek V4.1 Flash", "GLM-5.3 Flash-X", "Muse Spark 1.3"];

describe("OpenDesign plan constants", () => {
	test("prices, credit pools and windows match the live pricing page", () => {
		expect(Object.keys(OD_PLANS)).toEqual(["go", "plus", "pro", "max"]);
		const go = OD_PLANS.go;
		expect(go?.price).toBe(10);
		expect(go?.credits).toBe(220);
		expect(go?.weekly).toBe(55);
		expect(go?.fiveHour).toBe(18);
		// Plus and up have no 5-hour window; only the 7-day one applies.
		for (const id of ["plus", "pro", "max"]) {
			expect(OD_PLANS[id]?.fiveHour).toBeNull();
			expect(OD_PLANS[id]?.weekly).toBeGreaterThan(0);
		}
	});

	test("an unknown plan fails loud", () => {
		expect(() => loadOdCatalog("enterprise", priced(KEYS))).toThrow(/unknown OpenDesign plan/);
	});
});

describe("credit multiplier -> usable allowance", () => {
	test("allowance is the credit pool divided by the model's multiplier", () => {
		const { entries } = loadOdCatalog("go", priced(KEYS));
		const byKey = new Map(entries.map((e) => [e.key, e]));
		// Go's $220 coding pool at 0.5x buys $440 of DeepSeek V4.1 Flash usage.
		expect(byKey.get("deepseekv41flash")?.allowance).toBeCloseTo(440, 6);
		// 2x burns twice the credits for the same usage value.
		expect(byKey.get("glm53flashx")?.allowance).toBeCloseTo(110, 6);
	});

	test("a lower multiplier keeps the same token rates", () => {
		const { entries } = loadOdCatalog("go", priced([...KEYS, "DeepSeek V4.1 Flash Eco"]));
		const flash = entries.find((e) => e.key === "deepseekv41flash");
		const eco = entries.find((e) => e.key === "deepseekv41flasheco");
		expect(eco?.pricing).toEqual(flash?.pricing);
		expect(eco?.pricing).toBeDefined();
		expect(eco?.allowance).toBeGreaterThan(flash?.allowance ?? Infinity);
	});

	test("a model with no token rate is reported, never priced from thin air", () => {
		const load = loadOdCatalog("go", priced(KEYS));
		expect(load.missing).toContain("Kimi K2.7 Code");
		expect(load.entries.some((e) => e.key === "kimik27code")).toBe(false);
	});
});

describe("plan gating", () => {
	test("a top model is excluded on Go and priced on Plus", () => {
		const names = OD_MODELS.map((m) => m.name);
		const go = loadOdCatalog("go", priced(names));
		const plus = loadOdCatalog("plus", priced(names));
		expect(go.excluded).toContain("Muse Spark 1.3");
		expect(go.entries.some((e) => e.key === "musespark13")).toBe(false);
		const top = plus.entries.find((e) => e.key === "musespark13");
		expect(top).toBeDefined();
		// Top Model Credits draw directly: $20 on Plus, no multiplier.
		expect(top?.allowance).toBeCloseTo(OD_PLANS.plus?.top ?? 0, 6);
	});

	test("DeepSeek V4.1 Flash Eco is Go/Plus only", () => {
		const names = OD_MODELS.map((m) => m.name);
		expect(loadOdCatalog("go", priced(names)).excluded).not.toContain(
			"DeepSeek V4.1 Flash Eco",
		);
		expect(loadOdCatalog("pro", priced(names)).excluded).toContain("DeepSeek V4.1 Flash Eco");
	});
});

describe("requests per window", () => {
	const plans = (id: string): Map<SideId, PlanInfo> => new Map([["od", odPlan(id)]]);

	test("Go scales by its own 18/220 and 55/220 caps", () => {
		const entries = loadOdCatalog("go", priced(KEYS)).entries.filter(
			(e) => e.key === "glm53flashx",
		);
		const [m] = buildMetrics(entries, plans("go"), { od: workload });
		expect(m?.requestsPerFiveHour).toBeCloseTo((m?.requestsPerMonth ?? 0) * (18 / 220), 6);
		expect(m?.requestsPerWeek).toBeCloseTo((m?.requestsPerMonth ?? 0) * (55 / 220), 6);
	});

	test("Plus has no 5-hour window: 0 records the absence, the column prints a dash", () => {
		const entries = loadOdCatalog("plus", priced(KEYS)).entries.filter(
			(e) => e.key === "glm53flashx",
		);
		const [m] = buildMetrics(entries, plans("plus"), { od: workload });
		expect(m?.requestsPerFiveHour).toBe(0);
		expect(m?.requestsPerWeek).toBeCloseTo((m?.requestsPerMonth ?? 0) * (74 / 310), 6);
	});
});

describe("payload", () => {
	test("--od-plan rows carry the od block and the plan", () => {
		const loaded = loadOdCatalog("plus", priced(KEYS));
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
			{
				entries: loaded.entries,
				plan,
			},
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
