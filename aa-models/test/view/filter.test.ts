import { describe, expect, test } from "bun:test";
import { applyFilters } from "#~/filter.ts";
import type { Model } from "#~/model.ts";
import { parseWhere, resolvePath } from "#~/where.ts";
import { FIXTURE } from "./fixture.ts";

const names = (models: Model[]) => models.map((model) => model.name);

function pick(query: Parameters<typeof applyFilters>[1]): string[] {
	return names(applyFilters(FIXTURE, query).models);
}

describe("--model", () => {
	test("matches a case-insensitive regex over name and slug", () => {
		expect(pick({ model: "gpt|CLAUDE" })).toEqual(["GPT-6", "Claude Opus 5"]);
		expect(pick({ model: "opus-5" })).toEqual(["Claude Opus 5"]);
	});

	test("falls back to a substring on an invalid pattern", () => {
		expect(pick({ model: "deepseek(" })).toEqual(["DeepSeek V4.1 Flash"]);
	});
});

describe("--creator", () => {
	test("case-insensitive exact match over a comma list", () => {
		expect(pick({ creator: "openai, anthropic" })).toEqual([
			"GPT-6",
			"Claude Opus 5",
			"Acme Mini",
		]);
	});

	test("never matches a prefix or a null creator", () => {
		expect(pick({ creator: "open" })).toEqual([]);
	});
});

describe("numeric bounds", () => {
	test("a null value fails every bound", () => {
		expect(pick({ minIntel: 41 })).toEqual(["GPT-6", "Claude Opus 5"]);
		expect(pick({ maxIntel: 40.5 })).toEqual(["Mystery 1", "Acme Mini"]);
		expect(pick({ minTps: 100 })).toEqual(["GPT-6", "DeepSeek V4.1 Flash"]);
		expect(pick({ minContext: 200000 })).toEqual(["GPT-6", "Claude Opus 5"]);
	});
});

describe("tri-state and presence flags", () => {
	test("scored keeps measured models, unscored the opposite", () => {
		expect(pick({ scored: true })).toHaveLength(4);
		expect(pick({ unscored: true })).toEqual(["DeepSeek V4.1 Flash"]);
	});

	test("scored and unscored together is an error", () => {
		expect(() => applyFilters(FIXTURE, { scored: true, unscored: true })).toThrow();
	});

	test("open-weights and closed-weights leave a null out of both", () => {
		expect(pick({ openWeights: true })).toEqual(["DeepSeek V4.1 Flash"]);
		expect(pick({ closedWeights: true })).toEqual(["GPT-6", "Claude Opus 5"]);
	});
});

describe("--since", () => {
	test("keeps releases on or after the day; an undated model fails", () => {
		expect(pick({ since: "2026-09-01" })).toEqual(["GPT-6", "DeepSeek V4.1 Flash"]);
	});

	test("a non-date is reported, not silently obeyed", () => {
		const result = applyFilters(FIXTURE, { since: "last week" });
		expect(result.models).toHaveLength(FIXTURE.length);
		expect(result.notes[0]).toContain("--since last week");
	});
});

describe("--where", () => {
	test("numeric, string and regex operators", () => {
		expect(pick({ where: ["intelligenceIndex > 50"] })).toEqual(["GPT-6", "Claude Opus 5"]);
		expect(pick({ where: ["price.blended <= 1"] })).toEqual([
			"DeepSeek V4.1 Flash",
			"Acme Mini",
		]);
		expect(pick({ where: ["name ~ ^gpt"] })).toEqual(["GPT-6"]);
	});

	test("a date compares as text, and an array field matches any element", () => {
		expect(pick({ where: ["release.date >= 2026-10-01"] })).toEqual(["DeepSeek V4.1 Flash"]);
		expect(pick({ where: ["reasoning.efforts ~ high"] })).toEqual([
			"GPT-6",
			"DeepSeek V4.1 Flash",
		]);
	});

	test("clauses AND together", () => {
		expect(pick({ where: ["intelligenceIndex >= 40", "openWeights = false"] })).toEqual([
			"GPT-6",
			"Claude Opus 5",
		]);
	});

	test("a path nobody publishes excludes every row and is named in notes", () => {
		const result = applyFilters(FIXTURE, { where: ["inteligenceIndex > 50"] });
		expect(result.models).toEqual([]);
		expect(result.notes).toContain("--where inteligenceIndex: no model publishes this field");
	});

	test("an unusable expression is reported and ignored", () => {
		const result = applyFilters(FIXTURE, { where: ["intelligenceIndex"] });
		expect(result.models).toHaveLength(FIXTURE.length);
		expect(result.notes[0]).toContain("--where intelligenceIndex");
	});
});

describe("composition", () => {
	test("two flags combine, and the input array is untouched", () => {
		const before = [...FIXTURE];
		expect(pick({ creator: "openai", scored: true })).toEqual(["GPT-6", "Acme Mini"]);
		expect(FIXTURE).toEqual(before);
	});

	test("resolvePath walks dots and stops on a scalar", () => {
		expect(resolvePath(FIXTURE[0], "price.blended")).toBe(6.25);
		expect(resolvePath(FIXTURE[0], "price.nope")).toBeUndefined();
		expect(resolvePath(FIXTURE[0], "name.length")).toBeUndefined();
	});

	test("parseWhere keeps a value with spaces and rejects a bare path", () => {
		expect(parseWhere("name ~ big model")).toEqual({
			path: "name",
			op: "~",
			value: "big model",
		});
		expect(parseWhere("name")).toBeNull();
	});
});
