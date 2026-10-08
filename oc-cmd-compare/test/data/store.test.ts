import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	fillFromCache,
	readAbilityCache,
	writeAbilityCache,
} from "~/data/bench/store.ts";

const ORIGINAL = process.env.XDG_CACHE_HOME;
afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.XDG_CACHE_HOME;
	else process.env.XDG_CACHE_HOME = ORIGINAL;
});

const tempCache = () => {
	process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "mpc-cache-"));
};

describe("ability cache", () => {
	test("round-trips both maps", async () => {
		tempCache();
		const data = {
			intelligence: new Map([
				["glm53flash", 41.8],
				["deepseekv41flash", 39.5],
			]),
			tps: new Map([["deepseekv41flash", 217]]),
		};
		await writeAbilityCache(data);
		const cached = await readAbilityCache();
		expect(cached?.intelligence.get("glm53flash")).toBe(41.8);
		expect(cached?.tps.get("deepseekv41flash")).toBe(217);
	});

	test("refresh ignores what is on disk, and a cold cache reads as null", async () => {
		tempCache();
		await writeAbilityCache({
			intelligence: new Map([["a", 1]]),
			tps: new Map(),
		});
		expect(await readAbilityCache(true)).toBeNull();
		process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "mpc-empty-"));
		expect(await readAbilityCache()).toBeNull();
	});

	test("fillFromCache only adds keys the live run is missing", () => {
		const live = {
			intelligence: new Map([["live", 50]]),
			tps: new Map<string, number>(),
		};
		const added = fillFromCache(live, {
			intelligence: new Map([
				["live", 1], // stale: the live value wins
				["dropped", 42], // the page stopped publishing this one
			]),
			tps: new Map([["speed", 120]]),
		});
		expect(added).toBe(2);
		expect(live.intelligence.get("live")).toBe(50);
		expect(live.intelligence.get("dropped")).toBe(42);
		expect(live.tps.get("speed")).toBe(120);
	});
});
