import { describe, expect, test } from "bun:test";
import { DEFAULT_SORT_FIELD, resolveSortField, sortModels } from "#~/sort.ts";
import { FIXTURE } from "./fixture.ts";

const names = (models: { name: string }[]) => models.map((model) => model.name);

describe("default sort", () => {
	test("intelligence descending with the unscored model last", () => {
		expect(DEFAULT_SORT_FIELD).toBe("intelligenceIndex");
		expect(names(sortModels(FIXTURE))).toEqual([
			"GPT-6",
			"Claude Opus 5",
			"Acme Mini",
			"Mystery 1",
			"DeepSeek V4.1 Flash",
		]);
	});

	test("ties break on name, so two runs are byte-identical", () => {
		const once = names(sortModels(FIXTURE));
		const twice = names(sortModels([...FIXTURE].reverse()));
		expect(once).toEqual(twice);
	});
});

describe("direction", () => {
	test("--asc flips the order but a null still sorts last", () => {
		expect(names(sortModels(FIXTURE, "intelligence", true))).toEqual([
			"Acme Mini",
			"Mystery 1",
			"Claude Opus 5",
			"GPT-6",
			"DeepSeek V4.1 Flash",
		]);
	});

	test("the tps alias sorts by outputSpeed, nulls last in both directions", () => {
		expect(names(sortModels(FIXTURE, "tps", true))).toEqual([
			"Acme Mini",
			"Claude Opus 5",
			"DeepSeek V4.1 Flash",
			"GPT-6",
			"Mystery 1",
		]);
		expect(names(sortModels(FIXTURE, "tps", false))).toEqual([
			"GPT-6",
			"DeepSeek V4.1 Flash",
			"Claude Opus 5",
			"Acme Mini",
			"Mystery 1",
		]);
	});
});

describe("fields", () => {
	test("aliases resolve to the record's own path", () => {
		expect(resolveSortField("intelligence")).toBe("intelligenceIndex");
		expect(resolveSortField("released")).toBe("release.date");
		expect(resolveSortField("price")).toBe("price.blended");
		expect(resolveSortField("unknownField")).toBe("unknownField");
	});

	test("a dot-path is sorted directly and the input array is left alone", () => {
		const before = names(FIXTURE);
		const sorted = sortModels(FIXTURE, "release.date", false);
		expect(names(sorted)).toEqual([
			"DeepSeek V4.1 Flash",
			"GPT-6",
			"Claude Opus 5",
			"Acme Mini",
			"Mystery 1",
		]);
		expect(names(FIXTURE)).toEqual(before);
	});
});
