import { describe, expect, test } from "bun:test";
import {
	mergeModels,
	modelRecords,
	OPEN_DESIGN_SEED,
	odCost,
	parseModelList,
} from "../src/catalogOpenDesign";
import { DEFAULT_CONTEXT_LENGTH, DEFAULT_OUTPUT_TOKENS } from "../src/constants/models";

/** Two rows shaped exactly like `GET /v1/models` on 2026-11-16. */
const LISTING = {
	data: [
		{
			id: "deepseek-v4.1-flash",
			object: "model",
			architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
			metadata: { context_limit: 1_048_000, context_budget: 328_000, output_budget: 128_000 },
			default: true,
			enabled: true,
		},
		{
			id: "minimax-m3.1-flash",
			object: "model",
			architecture: { input_modalities: ["text", "image", "video", "file"] },
			metadata: { context_limit: 1_000_000 },
			enabled: true,
		},
	],
};

describe("seed", () => {
	test("both required ids are always seeded", () => {
		expect(OPEN_DESIGN_SEED.map((m) => m.id)).toEqual([
			"deepseek-v4.1-flash",
			"deepseek-v4.1-flash-eco",
		]);
	});
	test("limits are the listing's own, never a default", () => {
		const [flash] = modelRecords(OPEN_DESIGN_SEED) as Array<{
			limit: { context: number; output: number };
		}>;
		expect(flash?.limit).toEqual({ context: 1_048_000, output: 128_000 });
	});
	test("every published price-list row is priced, including Eco", () => {
		// Open Design's own price list gives both rows $0.3 / $1.2 per 1M; the
		// old $0.15 / $0.6 seed and the estimate label are gone.
		// Cache reads are published too and must ride through `odCost`, or every
		// opencode-derived cost figure understates a cache-heavy lane by the bill.
		expect(odCost("deepseek-v4.1-flash")).toEqual({
			input: 0.3,
			output: 1.2,
			cacheRead: 0.006,
			cacheWrite: 0,
		});
		expect(odCost("deepseek-v4.1-flash-eco")).toEqual({
			input: 0.3,
			output: 1.2,
			cacheRead: 0.006,
			cacheWrite: 0,
		});
		// A payload-only id that used to be unpriced is now table-backed too.
		expect(odCost("hy4-flash")).toEqual({
			input: 0.07,
			output: 0.281,
			cacheRead: 0.003,
			cacheWrite: 0,
		});
		expect(odCost("no-such-model")).toBeUndefined();
		const [flash, eco] = modelRecords(OPEN_DESIGN_SEED) as Array<{
			cost: Array<{ input: number; output: number }>;
		}>;
		expect(flash?.cost[0]?.input).toBe(0.3);
		expect(eco?.cost[0]?.output).toBe(1.2);
	});
});

describe("published cache rates reach the model record", () => {
	type Record_ = {
		id: string;
		cost: Array<{
			input: number;
			output: number;
			cache: { read: number; write: number };
		}>;
	};
	const records = (ids: string[]) =>
		modelRecords(
			ids.map((id) => ({
				id,
				name: id,
				context: 0,
				output: 0,
				modalities: ["text"] as const,
			})),
		) as Record_[];

	test("DeepSeek V4.1 Flash matches core/od.json exactly", () => {
		// Quoted from core/od.json: input 0.3, output 1.2, cacheRead 0.006, no cacheWrite.
		const [flash] = records(["deepseek-v4.1-flash"]);
		expect(flash?.cost).toEqual([
			{ input: 0.3, output: 1.2, cache: { read: 0.006, write: 0 } },
		]);
	});

	test("a row without a published cacheWrite advertises write 0", () => {
		const [flash] = records(["deepseek-v4.1-flash"]);
		expect(flash?.cost[0]?.cache.write).toBe(0);
	});

	test("an unpriced model still has no cost entry", () => {
		const [ghost] = records(["no-such-model"]);
		expect(ghost?.cost).toEqual([]);
	});
});

describe("parseModelList", () => {
	test("reads limits and modalities from the listing", () => {
		const [flash, mini] = parseModelList(LISTING);
		expect(flash).toMatchObject({
			id: "deepseek-v4.1-flash",
			name: "DeepSeek V4.1 Flash",
			context: 1_048_000,
			output: 128_000,
			modalities: ["text", "image"],
		});
		// A modality the host has no field for is dropped, not invented.
		expect(mini?.modalities).toEqual(["text", "image", "video"]);
		expect(mini?.output).toBe(0);
	});
	test("junk payloads read as no models instead of throwing", () => {
		expect(parseModelList(null)).toEqual([]);
		expect(parseModelList({})).toEqual([]);
		expect(parseModelList({ data: [{ id: "" }, { no: "id" }] })).toEqual([]);
	});
	test("a row with no published limits keeps 0 so the record falls back", () => {
		const list = parseModelList({ data: [{ id: "kimi-k2.7-code" }] });
		const [record] = modelRecords(list) as Array<{
			limit: { context: number; output: number };
		}>;
		expect(record?.limit).toEqual({
			context: DEFAULT_CONTEXT_LENGTH,
			output: DEFAULT_OUTPUT_TOKENS,
		});
	});
});

describe("mergeModels", () => {
	test("a live listing adds without deleting the seed", () => {
		const merged = mergeModels(OPEN_DESIGN_SEED, parseModelList(LISTING));
		expect(merged.length).toBe(3);
		expect(merged.map((m) => m.id)).toContain("deepseek-v4.1-flash-eco");
		expect(merged.map((m) => m.id)).toContain("minimax-m3.1-flash");
	});
});
