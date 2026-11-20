import { describe, expect, test } from "bun:test";
import type { Catalogue, Model } from "@jeffreyjyz/aa-models";
import { benchOf } from "#~/data/sources/aa.ts";

/** A model with every field, overridden by the case under test. */
function model(overrides: Partial<Model> & { keys: string[] }): Model {
	return {
		slug: overrides.keys[0] ?? "model",
		name: "Model",
		shortName: null,
		creator: null,
		release: { slug: null, name: null, date: null },
		intelligenceIndex: null,
		outputSpeed: null,
		latency: null,
		contextWindow: null,
		maxOutputTokens: null,
		price: null,
		openWeights: null,
		modalities: { input: [], output: [] },
		reasoning: { supported: null, efforts: [] },
		evals: {},
		variants: [],
		sources: ["leaderboard"],
		...overrides,
	};
}

function catalogue(models: Model[], indexVersion: string | null = null): Catalogue {
	return {
		models,
		sources: ["leaderboard"],
		indexVersion,
		fetchedAt: "2026-11-20T00:00:00.000Z",
		stale: false,
		notes: [],
	};
}

describe("benchOf", () => {
	test("maps every key a model answers to, so a dated slug resolves too", () => {
		const data = benchOf(
			catalogue([
				model({
					keys: ["deepseekv41flash", "deepseekv41flash1017"],
					intelligenceIndex: 32.6,
					outputSpeed: 251,
				}),
			]),
		);
		expect(data.intelligence.get("deepseekv41flash")).toBe(32.6);
		expect(data.intelligence.get("deepseekv41flash1017")).toBe(32.6);
		expect(data.tps.get("deepseekv41flash")).toBe(251);
	});

	test("a null score stays out of the maps while its speed still lands", () => {
		const data = benchOf(
			catalogue([model({ keys: ["longcat20"], intelligenceIndex: null, outputSpeed: 63.4 })]),
		);
		expect(data.intelligence.has("longcat20")).toBe(false);
		expect(data.tps.get("longcat20")).toBe(63.4);
	});

	test("the best value wins: a lower score never overwrites a higher one", () => {
		const data = benchOf(
			catalogue([
				model({ keys: ["hy4"], intelligenceIndex: 34.5, outputSpeed: 71.2 }),
				model({ keys: ["hy4"], intelligenceIndex: 30.1, outputSpeed: 90 }),
			]),
		);
		expect(data.intelligence.get("hy4")).toBe(34.5);
		expect(data.tps.get("hy4")).toBe(90);
	});

	test("carries the index version, and omits it when the catalogue has none", () => {
		expect(benchOf(catalogue([], "v5.0.1")).indexVersion).toBe("v5.0.1");
		expect(benchOf(catalogue([])).indexVersion).toBeUndefined();
	});
});
