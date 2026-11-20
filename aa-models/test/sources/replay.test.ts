import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "#~/model.ts";
import { loadCatalogue } from "#~/sources/index.ts";
import { aaPage } from "./page.ts";
import { healthy, leaderboardPage, stored, stubFetch } from "./live.ts";

const realFetch = globalThis.fetch;
let dir = "";

const seed = (models: Model[], ageMs = 3 * 3_600_000): string => {
	const body = JSON.stringify({ fetchedAt: Date.now() - ageMs, models });
	writeFileSync(join(dir, "last-good.json"), body);
	return body;
};

const route = (url: string, page: string) =>
	url.includes("/api/v2/")
		? new Response('{"error":"Rate limit exceeded"}', { status: 429 })
		: url === "https://artificialanalysis.ai/" || url.includes("/data/fixture.txt")
			? healthy(url)
			: new Response(page);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-models-"));
	process.env.AA_CACHE_DIR = dir;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.AA_CACHE_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe("last-good replay", () => {
	test("every live source failing replays the whole store", async () => {
		stubFetch(healthy);
		await loadCatalogue({ cacheTtlMs: 0 });
		stubFetch(() => {
			throw new Error("offline");
		});
		const stale = await loadCatalogue({ cacheTtlMs: 0 });
		expect(stale.stale).toBe(true);
		expect(stale.models).toHaveLength(5);
		expect(stale.notes.some((note) => note.startsWith("last good,"))).toBe(true);
	});

	test("a spent API quota fills the speeds it alone published, and says how old", async () => {
		const page = aaPage([
			{
				slug: "jt-35b-flash",
				name: "JT-35B-Flash",
				release: { slug: "jt-35b-flash" },
				intelligenceIndex: 12.4,
			},
		]);
		const before = seed([
			stored("jt-35b-flash", { outputSpeed: 96.5, outputSpeedSource: "api" }),
		]);
		stubFetch((url) => route(url, page));

		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "spent" });
		const jt = catalogue.models.find((model) => model.slug === "jt-35b-flash");
		expect(jt?.outputSpeed).toBeCloseTo(96.5, 3);
		expect(jt?.intelligenceIndex).toBeCloseTo(12.4, 3);
		expect(catalogue.stale).toBe(true);
		expect(catalogue.notes).toContain("last good, 3h old");
		expect(catalogue.notes.some((note) => note.includes("429"))).toBe(true);
		// A partial run must not stamp the store: its age is what a later replay reports.
		expect(readFileSync(join(dir, "last-good.json"), "utf8")).toBe(before);
	});

	test("a replay restores the failed source's tier and keeps a live same-tier figure", async () => {
		const page = aaPage([
			{
				slug: "claude-opus-5-5",
				name: "Claude Opus 5.5",
				release: { slug: "claude-opus-5-5" },
				intelligenceIndex: 57.6,
				outputSpeed: 101.5,
			},
			{
				slug: "qwen3-5-omni-plus",
				name: "Qwen3.5 Omni Plus",
				release: { slug: "qwen3-5-omni-plus" },
				intelligenceIndex: 20,
				outputSpeed: 63.37,
			},
		]);
		seed([
			// The API's documented median, which today's run could not ask for.
			stored("claude-opus-5-5", { outputSpeed: 229.62, outputSpeedSource: "api" }),
			// The same tier the live page published, so the live figure keeps the slot.
			stored("qwen3-5-omni-plus", { outputSpeed: 999, outputSpeedSource: "page" }),
		]);
		stubFetch((url) => route(url, page));

		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "spent" });
		const opus = catalogue.models.find((model) => model.slug === "claude-opus-5-5");
		expect(opus?.outputSpeed).toBeCloseTo(229.62, 3);
		expect(opus?.outputSpeedSource).toBe("api");
		const qwen = catalogue.models.find((model) => model.slug === "qwen3-5-omni-plus");
		expect(qwen?.outputSpeed).toBeCloseTo(63.37, 3);
		expect(qwen?.outputSpeedSource).toBe("page");
	});

	test("a model only the API listed comes back with the replay", async () => {
		seed([stored("gpt-5-6-luna", { outputSpeed: 210.4, outputSpeedSource: "api" })]);
		stubFetch((url) => route(url, leaderboardPage));
		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "spent" });
		expect(catalogue.models.some((model) => model.slug === "gpt-5-6-luna")).toBe(true);
		expect(catalogue.stale).toBe(true);
	});
});

describe("outputSpeed priority", () => {
	test("the API's documented field beats a larger page figure for one model", async () => {
		const page = aaPage([
			{
				slug: "glm-5-3-flash",
				name: "GLM-5.3 Flash",
				release: { slug: "glm-5-3-flash" },
				intelligenceIndex: 31.6,
				outputSpeed: 73.09,
			},
		]);
		stubFetch((url) =>
			url.includes("/api/v2/") || url === "https://artificialanalysis.ai/"
				? healthy(url)
				: url.includes("/data/fixture.txt")
					? healthy(url)
					: new Response(page),
		);

		const catalogue = await loadCatalogue({ cacheTtlMs: 0, apiKey: "live" });
		const glm = catalogue.models.find((model) => model.slug === "glm-5-3-flash");
		expect(glm?.outputSpeed).toBeCloseTo(72.85, 3);
		expect(glm?.outputSpeedSource).toBe("api");
		expect(glm?.intelligenceIndex).toBeCloseTo(31.6, 3);
		expect(catalogue.stale).toBe(false);
	});
});
