import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalogue } from "#~/sources/index.ts";
import { aaPage, readRows } from "./page.ts";

const leaderboard = aaPage(readRows("leaderboard.rows.json"));
const realFetch = globalThis.fetch;

let dir = "";
let calls: string[] = [];

const stub = (handler: (url: string) => Response) => {
	globalThis.fetch = ((input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		return Promise.resolve(handler(url));
	}) as typeof fetch;
};

const apiPage = (url: string) => {
	const page = Number(new URL(url).searchParams.get("page") ?? "1");
	const data =
		page === 1
			? [
					{
						name: "Claude Opus 5.5 (max)",
						slug: "claude-opus-5-5",
						evaluations: { artificial_analysis_intelligence_index: 57.6 },
						performance: { median_output_tokens_per_second: 88.4 },
					},
				]
			: [
					{
						name: "GLM-5.3 Flash (high)",
						slug: "glm-5-3-flash",
						evaluations: { artificial_analysis_intelligence_index: 30.5 },
					},
				];
	return JSON.stringify({
		intelligence_index_version: "v5.0.1",
		pagination: { page, has_more: page === 1 },
		data,
	});
};

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-models-"));
	process.env.AA_CACHE_DIR = dir;
	calls = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.AA_CACHE_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe("loadCatalogue", () => {
	test("keyless load merges both pages and writes both stores", async () => {
		stub(() => new Response(leaderboard));
		const catalogue = await loadCatalogue({ cacheTtlMs: 3_600_000 });
		expect(catalogue.models).toHaveLength(3);
		expect(catalogue.sources).toEqual(["leaderboard", "models"]);
		expect(catalogue.stale).toBe(false);
		expect(catalogue.notes.some((note) => note.startsWith("manifest:"))).toBe(true);
		expect(existsSync(join(dir, "catalogue.json"))).toBe(true);
		expect(existsSync(join(dir, "last-good.json"))).toBe(true);
	});

	test("a cache hit says so and touches no network", async () => {
		stub(() => new Response(leaderboard));
		await loadCatalogue({ cacheTtlMs: 3_600_000 });
		stub(() => {
			throw new Error("network must not be used");
		});
		calls = [];
		const again = await loadCatalogue({ cacheTtlMs: 3_600_000 });
		expect(again.models).toHaveLength(3);
		expect(again.notes.some((note) => note.startsWith("cache:"))).toBe(true);
		expect(calls).toHaveLength(0);
	});

	test("--refresh bypasses the cache", async () => {
		stub(() => new Response(leaderboard));
		await loadCatalogue({ cacheTtlMs: 3_600_000 });
		calls = [];
		await loadCatalogue({ cacheTtlMs: 3_600_000, refresh: true });
		expect(calls.length).toBeGreaterThanOrEqual(2);
	});

	test("an empty run persists nothing and throws with the reason", async () => {
		stub(() => new Response("<html></html>"));
		await expect(loadCatalogue({ cacheTtlMs: 0 })).rejects.toThrow("initialModels");
		expect(existsSync(join(dir, "catalogue.json"))).toBe(false);
		expect(existsSync(join(dir, "last-good.json"))).toBe(false);
	});

	test("last good replays, labelled, when every live source fails", async () => {
		stub(() => new Response(leaderboard));
		await loadCatalogue({ cacheTtlMs: 0 });
		stub(() => {
			throw new Error("offline");
		});
		const stale = await loadCatalogue({ cacheTtlMs: 0 });
		expect(stale.stale).toBe(true);
		expect(stale.models).toHaveLength(3);
		expect(stale.notes.some((note) => note.startsWith("last good,"))).toBe(true);
	});
});

describe("api source", () => {
	const route = (url: string) =>
		url.includes("/api/v2/") ? new Response(apiPage(url)) : new Response(leaderboard);

	test("runs when keyed, follows pagination and reports the index version", async () => {
		stub(route);
		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "test-key" });
		expect(catalogue.indexVersion).toBe("v5.0.1");
		expect(catalogue.sources).toContain("api");
		expect(catalogue.models.some((model) => model.slug === "claude-opus-5-5")).toBe(true);
		expect(catalogue.models.some((model) => model.slug === "glm-5-3-flash")).toBe(true);
		const apiCalls = calls.filter((url) => url.includes("/api/v2/"));
		expect(apiCalls).toHaveLength(2);
		expect(apiCalls[1]).toContain("page=2");
	});

	test("--no-api skips it even with a key", async () => {
		stub(route);
		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "test-key", noApi: true });
		expect(catalogue.sources).not.toContain("api");
		expect(calls.some((url) => url.includes("/api/v2/"))).toBe(false);
	});

	test("a rejected key is a note, not a blank catalogue", async () => {
		stub((url) =>
			url.includes("/api/v2/")
				? new Response('{"error":"API key is required"}', { status: 401 })
				: new Response(leaderboard),
		);
		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "stale" });
		expect(catalogue.models).toHaveLength(3);
		expect(catalogue.notes.some((note) => note.includes("AA_API_KEY rejected"))).toBe(true);
	});
});
