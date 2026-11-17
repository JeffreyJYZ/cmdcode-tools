import { describe, expect, test } from "bun:test";
import { OD_MODELS } from "#~/data/sources/od/models.ts";
import { OD_PLANS } from "#~/data/sources/od/plans.ts";
import { capFor, loadOdCatalog } from "#~/data/sources/od/index.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CatalogEntry, ProviderId } from "#~/types.ts";
import { odPriced } from "../unit/fixtures.ts";

const priced = (keys: string[]): Record<ProviderId, CatalogEntry[]> => odPriced(keys);
const KEYS = ["DeepSeek V4.1 Flash", "GLM-5.3 Flash-X", "Muse Spark 1.3"];
const ECO = "DeepSeek V4.1 Flash Eco";

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

	test("Go and Plus publish per-model caps; Pro and Max publish one pool", () => {
		expect(OD_PLANS.go?.caps?.deepseekv41flasheco).toEqual({
			month: 220,
			week: 55,
			fiveHour: 18,
		});
		expect(OD_PLANS.go?.caps?.deepseekv41flash).toEqual({
			month: 120,
			week: 30,
			fiveHour: 10,
		});
		expect(OD_PLANS.plus?.caps?.deepseekv41flash).toEqual({
			month: 160,
			week: 40,
			fiveHour: null,
		});
		expect(OD_PLANS.pro?.caps).toBeUndefined();
		expect(OD_PLANS.max?.caps).toBeUndefined();
	});

	test("an unknown plan fails loud", () => {
		expect(() => loadOdCatalog("enterprise", priced(KEYS))).toThrow(/unknown OpenDesign plan/);
	});
});

describe("published caps -> usable allowance", () => {
	test("Flash and Eco on Go resolve to different allowances", () => {
		const { entries } = loadOdCatalog("go", priced([...KEYS, ECO]));
		const byKey = new Map(entries.map((e) => [e.key, e]));
		const flash = byKey.get("deepseekv41flash");
		const eco = byKey.get("deepseekv41flasheco");
		// The published caps ARE the allowance on Go: $120 for Flash, $220 for Eco.
		expect(flash?.allowance).toBe(120);
		expect(eco?.allowance).toBe(220);
		expect(eco?.cap?.week).toBe(55);
		expect(flash?.cap?.week).toBe(30);
		expect(flash?.cap?.fiveHour).toBe(10);
		// A model with no row of its own draws the plan's default (Eco) set.
		expect(byKey.get("glm53flashx")?.allowance).toBe(220);
		expect(byKey.get("glm53flashx")?.cap).toEqual(eco?.cap);
	});

	test("Plus publishes a different pair, with no 5-hour window", () => {
		const { entries } = loadOdCatalog("plus", priced([...KEYS, ECO]));
		const byKey = new Map(entries.map((e) => [e.key, e]));
		expect(byKey.get("deepseekv41flash")?.allowance).toBe(160);
		expect(byKey.get("deepseekv41flasheco")?.allowance).toBe(290);
		expect(byKey.get("deepseekv41flash")?.cap?.fiveHour).toBeNull();
	});

	test("Pro keeps one pool: plan credits divided by the model's multiplier", () => {
		const { entries } = loadOdCatalog("pro", priced(KEYS));
		const byKey = new Map(entries.map((e) => [e.key, e]));
		const pool = OD_PLANS.pro?.credits ?? 0;
		expect(byKey.get("deepseekv41flash")?.allowance).toBeCloseTo(pool / 0.5, 6);
		expect(byKey.get("glm53flashx")?.allowance).toBeCloseTo(pool / 2, 6);
		// No per-model cap: the plan's own windows apply, unchanged.
		expect(byKey.get("deepseekv41flash")?.cap).toBeUndefined();
	});

	test("a model with no published cap is absent, never a zero cap", () => {
		OD_PLANS.nocaps = {
			label: "NoCaps",
			price: 0,
			credits: 0,
			coding: 0,
			top: 0,
			fiveHour: null,
			weekly: 0,
			concurrency: 0,
		};
		try {
			const flash = OD_MODELS.find((m) => normalizeKey(m.name) === "deepseekv41flash");
			if (!flash) throw new Error("fixture model missing");
			expect(capFor(flash, "nocaps")).toBeNull();
			const load = loadOdCatalog("nocaps", priced(["DeepSeek V4.1 Flash"]));
			expect(load.entries).toHaveLength(0);
			expect(load.uncapped).toContain("DeepSeek V4.1 Flash");
		} finally {
			delete OD_PLANS.nocaps;
		}
	});

	test("a lower multiplier keeps the same token rates", () => {
		const { entries } = loadOdCatalog("go", priced([...KEYS, ECO]));
		const flash = entries.find((e) => e.key === "deepseekv41flash");
		const eco = entries.find((e) => e.key === "deepseekv41flasheco");
		expect(eco?.pricing).toEqual(flash?.pricing);
		expect(eco?.pricing).toBeDefined();
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
		expect(top?.cap).toBeUndefined();
		// Top Model Credits draw directly: $20 on Plus, no multiplier.
		expect(top?.allowance).toBeCloseTo(OD_PLANS.plus?.top ?? 0, 6);
	});

	test("DeepSeek V4.1 Flash Eco is Go/Plus only", () => {
		const names = OD_MODELS.map((m) => m.name);
		expect(loadOdCatalog("go", priced(names)).excluded).not.toContain(ECO);
		expect(loadOdCatalog("pro", priced(names)).excluded).toContain(ECO);
	});
});
