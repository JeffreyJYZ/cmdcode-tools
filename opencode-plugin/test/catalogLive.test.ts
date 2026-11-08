import { describe, expect, test } from "bun:test";
import { MODEL_CATALOG, modelCost } from "../src/catalog";
import {
	applyLiveCatalog,
	liveContext,
	liveCost,
	liveEfforts,
	liveMinPlan,
	normalizeMinPlan,
	parseCount,
	parseModelsMd,
} from "../src/catalogLive";

const MD = [
	"| Id (use EXACTLY this) | Name | Context | Efforts | $/1M in/out · cache read | Min plan | Best for |",
	"|---|---|---|---|---|---|---|",
	"| `deepseek/deepseek-v4.1-flash` | DeepSeek V4.1 Flash (latest) | 1M | off, low, high, max | $0.15/$0.6 · cache $0.003 | Go and above | reasoning |",
	"| `claude-opus-5-1` | Claude Opus 5.1 | 1.05M | low, high | $5/$25 · cache $0.5 (write $6.25) | Pro and above | frontier |",
	"| `free/beam` | Beam | 256K | — | $0/$0 · cache $0 | Free | free tier |",
	"| not a model row | x | y | z | nope | | |",
].join("\n");

describe("parseModelsMd", () => {
	test("reads context, efforts, rates and min plan", () => {
		const rows = parseModelsMd(MD);
		expect(Object.keys(rows).sort()).toEqual([
			"claude-opus-5-1",
			"deepseek/deepseek-v4.1-flash",
			"free/beam",
		]);
		expect(rows["deepseek/deepseek-v4.1-flash"]).toEqual({
			name: "DeepSeek V4.1 Flash (latest)",
			context: 1_000_000,
			efforts: ["off", "low", "high", "max"],
			cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
			minPlan: "Go",
		});
		expect(rows["claude-opus-5-1"]?.context).toBe(1_050_000);
		expect(rows["claude-opus-5-1"]?.cost.cacheWrite).toBe(6.25);
		// An em dash means "no efforts", not an empty list.
		expect(rows["free/beam"]?.efforts).toBeNull();
	});
	test("drops a row with no parsable rate", () => {
		expect(parseModelsMd("| `x/y` | Y | 1M | high | free | Go | n |")).toEqual({});
	});
});

describe("count and plan parsing", () => {
	test("units", () => {
		expect(parseCount("1M")).toBe(1_000_000);
		expect(parseCount("1.05M")).toBe(1_050_000);
		expect(parseCount("256K")).toBe(256_000);
		expect(parseCount("1050000")).toBe(1_050_000);
		expect(parseCount("—")).toBe(0);
	});
	test("plan names", () => {
		expect(normalizeMinPlan("Go and above")).toBe("Go");
		expect(normalizeMinPlan("GOAT and above")).toBe("GOAT");
		expect(normalizeMinPlan("—")).toBeNull();
	});
});

describe("live overlay", () => {
	const baked = modelCost("deepseek/deepseek-v4.1-flash");
	test("live values win over the baked snapshot", () => {
		applyLiveCatalog({
			"deepseek/deepseek-v4.1-flash": {
				name: "DeepSeek V4.1 Flash",
				context: 2_000_000,
				efforts: ["high"],
				cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 0 },
				minPlan: "Pro",
			},
		});
		expect(liveCost("deepseek/deepseek-v4.1-flash")?.input).toBe(9);
		expect(liveContext("deepseek/deepseek-v4.1-flash")).toBe(2_000_000);
		expect(liveMinPlan("deepseek/deepseek-v4.1-flash")).toBe("Pro");
		expect(liveEfforts("deepseek/deepseek-v4.1-flash")).toEqual(["high"]);
	});
	test("a model the document omits keeps its baked row", () => {
		const other = "claude-sonnet-5";
		expect(liveCost(other)).toEqual(modelCost(other));
		expect(liveContext(other)).toBe(MODEL_CATALOG[other]?.context);
	});
	test("clearing the overlay restores the snapshot", () => {
		applyLiveCatalog(null);
		expect(liveCost("deepseek/deepseek-v4.1-flash")).toEqual(baked);
	});
});
