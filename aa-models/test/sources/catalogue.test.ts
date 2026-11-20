import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalogue } from "#~/sources/index.ts";
import { healthy, stubFetch } from "./live.ts";

const realFetch = globalThis.fetch;
let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-models-"));
	process.env.AA_CACHE_DIR = dir;
	process.env.AA_LEGACY_DIR = join(dir, "mpc");
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.AA_CACHE_DIR;
	delete process.env.AA_LEGACY_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe("loadCatalogue", () => {
	test("a run every source answers merges them and writes both stores", async () => {
		stubFetch(healthy);
		const catalogue = await loadCatalogue({ cacheTtlMs: 3_600_000 });
		expect(catalogue.models.map((model) => model.slug).sort()).toEqual([
			"agnes-2-5-pro-beta",
			"claude-4-5-haiku",
			"claude-sonnet-5-5",
			"jt-35b-flash",
			"qwen3-5-omni-plus",
		]);
		expect(catalogue.sources).toEqual(["manifest", "leaderboard", "models"]);
		expect(catalogue.stale).toBe(false);
		expect(catalogue.notes).toEqual([]);
		expect(existsSync(join(dir, "catalogue.json"))).toBe(true);
		expect(existsSync(join(dir, "last-good.json"))).toBe(true);
	});

	test("a cache hit says so and touches no network", async () => {
		stubFetch(healthy);
		await loadCatalogue({ cacheTtlMs: 3_600_000 });
		const calls = stubFetch(() => {
			throw new Error("network must not be used");
		});
		const again = await loadCatalogue({ cacheTtlMs: 3_600_000 });
		expect(again.models).toHaveLength(5);
		expect(again.stale).toBe(false);
		expect(again.notes.some((note) => note.startsWith("cache:"))).toBe(true);
		expect(calls).toHaveLength(0);
	});

	test("--refresh bypasses the cache", async () => {
		stubFetch(healthy);
		await loadCatalogue({ cacheTtlMs: 3_600_000 });
		const calls = stubFetch(healthy);
		await loadCatalogue({ cacheTtlMs: 3_600_000, refresh: true });
		expect(calls.length).toBeGreaterThanOrEqual(2);
	});

	test("an empty run persists nothing and throws with the reason", async () => {
		stubFetch(() => new Response("<html></html>"));
		await expect(loadCatalogue({ cacheTtlMs: 0 })).rejects.toThrow("initialModels");
		expect(existsSync(join(dir, "catalogue.json"))).toBe(false);
		expect(existsSync(join(dir, "last-good.json"))).toBe(false);
	});
});
