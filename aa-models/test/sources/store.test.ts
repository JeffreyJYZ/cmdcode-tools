import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "#~/model.ts";
import {
	LAST_GOOD_REVISION,
	LAST_GOOD_SCHEMA,
	hasApiSpeed,
	lastGoodPath,
	mergeStore,
	readLastGood,
	writeLastGood,
} from "#~/sources/lastGood.ts";
import { applyMpcStore, mpcStorePath, readMpcStore } from "#~/sources/mpcStore.ts";
import { stored } from "./live.ts";

let dir = "";
let legacy = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-store-"));
	legacy = mkdtempSync(join(tmpdir(), "aa-legacy-"));
	process.env.AA_CACHE_DIR = dir;
	process.env.AA_LEGACY_DIR = legacy;
});

afterEach(() => {
	delete process.env.AA_CACHE_DIR;
	delete process.env.AA_LEGACY_DIR;
	rmSync(dir, { recursive: true, force: true });
	rmSync(legacy, { recursive: true, force: true });
});

const forge = (body: unknown): void => {
	writeFileSync(lastGoodPath(), JSON.stringify(body));
};

const speedOf = (models: Model[]) =>
	models.map((model) => [model.slug, model.outputSpeed, model.outputSpeedSource]);

describe("last-good store identity", () => {
	test("a store with no tier predates the field and reads as the page tier", async () => {
		forge({ fetchedAt: Date.now(), models: [stored("glm-5-3", { outputSpeed: 73.09 })] });
		const read = await readLastGood();
		expect(read?.models[0]?.outputSpeedSource).toBe("page");
	});

	test("a store this build wrote keeps the tier it recorded", async () => {
		await writeLastGood([stored("glm-5-3", { outputSpeed: 72.85, outputSpeedSource: "api" })]);
		const parsed = JSON.parse(readFileSync(lastGoodPath(), "utf8")) as Record<string, unknown>;
		expect(parsed.schema).toBe(LAST_GOOD_SCHEMA);
		expect(parsed.revision).toBe(LAST_GOOD_REVISION);
		const read = await readLastGood();
		expect(read?.models[0]?.outputSpeedSource).toBe("api");
	});

	test("a store from another revision or schema is ignored", async () => {
		forge({
			schema: LAST_GOOD_SCHEMA,
			revision: "0",
			models: [stored("a", { outputSpeed: 1 })],
		});
		expect(await readLastGood()).toBeUndefined();
		forge({
			schema: "aa-models/last-good/0",
			revision: LAST_GOOD_REVISION,
			models: [stored("a")],
		});
		expect(await readLastGood()).toBeUndefined();
	});
});

describe("mergeStore", () => {
	test("a page-tier live figure never replaces a stored api-tier one", () => {
		const live = [
			stored("deepseek-v4-1-flash", { outputSpeed: 160.63, outputSpeedSource: "page" }),
		];
		const store = [
			stored("deepseek-v4-1-flash", { outputSpeed: 229.62, outputSpeedSource: "api" }),
		];
		const [merged] = mergeStore(live, store);
		expect(merged?.outputSpeed).toBeCloseTo(229.62, 3);
		expect(merged?.outputSpeedSource).toBe("api");
	});

	test("a live api-tier figure is kept against a stored page-tier one", () => {
		const live = [stored("glm-5-3", { outputSpeed: 73.09, outputSpeedSource: "api" })];
		const store = [stored("glm-5-3", { outputSpeed: 72.85, outputSpeedSource: "page" })];
		expect(mergeStore(live, store)[0]?.outputSpeed).toBeCloseTo(73.09, 3);
	});

	test("only live rows are written, with a stored figure filling a blank", () => {
		const live = [stored("one", { outputSpeed: null }), stored("two")];
		const store = [
			stored("one", { outputSpeed: 12.5, outputSpeedSource: "api" }),
			stored("gone"),
		];
		expect(speedOf(mergeStore(live, store))).toEqual([
			["one", 12.5, "api"],
			["two", null, undefined],
		]);
	});
});

describe("mpc legacy store", () => {
	const writeLegacy = (body: unknown): void => {
		writeFileSync(mpcStorePath(), JSON.stringify(body));
	};

	test("the pre-package shape is read and joined by key", async () => {
		writeLegacy({
			fetchedAt: 1_795_169_510_017,
			intelligence: [["glm53", 31.6]],
			tps: [["glm53", 72.85]],
		});
		const read = await readMpcStore();
		expect(read?.speeds).toEqual([["glm53", 72.85]]);
		expect(read?.fetchedAt).toBe(1_795_169_510_017);
		const models = [
			stored("glm-5-3", { keys: ["glm53"], outputSpeed: 73.09, outputSpeedSource: "page" }),
		];
		expect(applyMpcStore(models, read as NonNullable<typeof read>)).toEqual({
			speeds: 1,
			scores: 1,
		});
		expect(models[0]?.outputSpeed).toBeCloseTo(72.85, 3);
		expect(models[0]?.outputSpeedSource).toBe("api");
		expect(models[0]?.intelligenceIndex).toBeCloseTo(31.6, 3);
	});

	test("a missing or malformed legacy file is undefined, never a throw", async () => {
		expect(await readMpcStore()).toBeUndefined();
		writeFileSync(mpcStorePath(), "{not json");
		expect(await readMpcStore()).toBeUndefined();
		writeLegacy({ tps: [["only-a-key"], "nope", [3, 4]] });
		expect(await readMpcStore()).toBeUndefined();
	});

	test("an equal-tier figure already present is never replaced by the legacy one", () => {
		const models = [stored("m", { keys: ["m"], outputSpeed: 200, outputSpeedSource: "api" })];
		applyMpcStore(models, { fetchedAt: 0, speeds: [["m", 100]], scores: [] });
		expect(models[0]?.outputSpeed).toBe(200);
	});

	test("hasApiSpeed answers only for an api-tier figure", () => {
		expect(hasApiSpeed([stored("a", { outputSpeed: 1, outputSpeedSource: "page" })])).toBe(
			false,
		);
		expect(hasApiSpeed([stored("a", { outputSpeed: 1, outputSpeedSource: "api" })])).toBe(true);
	});
});
