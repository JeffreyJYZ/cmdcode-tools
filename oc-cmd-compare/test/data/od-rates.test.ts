import { describe, expect, test } from "bun:test";
import od from "../../../core/od.json";
import { OD_MODELS } from "#~/data/sources/od/models.ts";
import { OD_PLANS } from "#~/data/sources/od/plans.ts";
import { loadOdCatalog } from "#~/data/sources/od/index.ts";
import { odRate } from "#~/data/sources/od/rates.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CatalogEntry, ProviderId } from "#~/types.ts";
import { odPriced } from "../unit/fixtures.ts";

const priced = (keys: string[]): Record<ProviderId, CatalogEntry[]> => odPriced(keys);
const KEYS = ["DeepSeek V4.1 Flash", "GLM-5.3 Flash-X", "Muse Spark 1.3"];
const UNLISTED = {
	name: "Unlisted Model",
	id: "no-such-model",
	multiplier: 1,
	tier: "coding",
} as const;

describe("published rates come from core/od.json", () => {
	test("every listed model's pricing equals its published row", () => {
		const { entries } = loadOdCatalog("go", priced([]));
		const byKey = new Map(entries.map((e) => [e.key, e]));
		for (const model of OD_MODELS) {
			const row = od.models.find((m) => m.id === model.id);
			expect(row, `no core/od.json row for ${model.id}`).toBeDefined();
			if (!row) continue;
			const entry = byKey.get(normalizeKey(model.name));
			// A model excluded from Go or capped at zero has no entry; anything
			// present must carry exactly the published rates, never a 2x-low copy.
			if (!entry) continue;
			expect(entry.pricing).toEqual({
				input: row.input,
				output: row.output,
				cacheRead: row.cacheRead,
				cacheWrite: row.cacheWrite ?? null,
			});
		}
	});

	test("DeepSeek V4.1 Flash is priced at the published rate, not half", () => {
		const { entries } = loadOdCatalog("go", priced(KEYS));
		const flash = entries.find((e) => e.key === "deepseekv41flash");
		expect(flash?.pricing).toEqual({
			input: 0.3,
			output: 1.2,
			cacheRead: 0.006,
			cacheWrite: null,
		});
	});

	test("the published multiplier wins over the fallback table", () => {
		// Literal quoted from core/od.json's claude-haiku-5.5 row; OD_MODELS holds
		// 4x as the open-conflict fallback, but the published 2x must be used.
		expect(odRate("claude-haiku-5.5")?.multiplier).toBe(2);
		const { entries } = loadOdCatalog("pro", priced([]));
		const haiku = entries.find((e) => e.key === "claudehaiku55");
		const credits = OD_PLANS.pro?.credits ?? 0;
		expect(haiku?.allowance).toBeCloseTo(credits / 2, 6);
		expect(haiku?.allowance).not.toBeCloseTo(credits / 4, 6);
	});

	test("no row prices from another catalog even when one offers a rate", () => {
		// A deliberately wrong CC/OC rate must be ignored for a model the
		// published list carries — that cross-pricing was the 2x defect.
		const other = odPriced(KEYS);
		const first = other.cc[0];
		if (!first) throw new Error("fixture row missing");
		first.pricing = { input: 1, output: 1, cacheRead: 1, cacheWrite: null };
		const { entries, crossPriced } = loadOdCatalog("go", other);
		expect(crossPriced).toEqual([]);
		const flash = entries.find((e) => e.key === "deepseekv41flash");
		expect(flash?.pricing).toEqual({
			input: 0.3,
			output: 1.2,
			cacheRead: 0.006,
			cacheWrite: null,
		});
	});
});

describe("missing and cross-priced models", () => {
	test("no row and no catalog rate is reported, never priced from thin air", () => {
		OD_MODELS.push({ ...UNLISTED, tier: "coding" });
		try {
			const load = loadOdCatalog("go", priced([]));
			expect(load.missing).toContain(UNLISTED.name);
			expect(load.entries.some((e) => e.key === "unlistedmodel")).toBe(false);
			expect(load.crossPriced).not.toContain(UNLISTED.name);
		} finally {
			OD_MODELS.pop();
		}
	});

	test("no row but a catalog rate is flagged, never passed as published", () => {
		OD_MODELS.push({ ...UNLISTED, tier: "coding" });
		try {
			const load = loadOdCatalog("go", priced([UNLISTED.name]));
			expect(load.crossPriced).toContain(UNLISTED.name);
			expect(load.entries.some((e) => e.key === "unlistedmodel")).toBe(true);
		} finally {
			OD_MODELS.pop();
		}
	});
});
