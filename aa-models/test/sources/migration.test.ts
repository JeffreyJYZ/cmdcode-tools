import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "#~/model.ts";
import { loadCatalogue } from "#~/sources/index.ts";
import { lastGoodPath } from "#~/sources/lastGood.ts";
import { mpcStorePath } from "#~/sources/mpcStore.ts";
import { stored, healthy, stubFetch } from "./live.ts";

/** The keyless `Qwen3.5 Omni Plus` fixture row: 63.37 tok/s, page tier. */
const KEY = "qwen35omniplus";
const LEGACY = JSON.stringify({
	fetchedAt: 1_795_169_510_017,
	intelligence: [[KEY, 44.5]],
	tps: [[KEY, 229.62]],
});

const realFetch = globalThis.fetch;
let dir = "";
let legacy = "";
const pick = (models: Model[]) => models.find((model) => model.slug === "qwen3-5-omni-plus");

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-migrate-"));
	legacy = mkdtempSync(join(tmpdir(), "aa-mpc-"));
	process.env.AA_CACHE_DIR = dir;
	process.env.AA_LEGACY_DIR = legacy;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.AA_CACHE_DIR;
	delete process.env.AA_LEGACY_DIR;
	rmSync(dir, { recursive: true, force: true });
	rmSync(legacy, { recursive: true, force: true });
});

const storeModels = (): Array<Record<string, unknown>> =>
	(JSON.parse(readFileSync(lastGoodPath(), "utf8")) as { models: Array<Record<string, unknown>> })
		.models;

describe("mpc legacy import", () => {
	test("a store with no api tier imports the API payload once and keeps its tier", async () => {
		stubFetch(healthy);
		const first = await loadCatalogue({ cacheTtlMs: 0 });
		expect(pick(first.models)?.outputSpeedSource).toBe("page");
		expect(first.notes).toEqual([]);

		writeFileSync(mpcStorePath(), LEGACY);
		const second = await loadCatalogue({ cacheTtlMs: 0 });
		const qwen = pick(second.models);
		expect(qwen?.outputSpeed).toBeCloseTo(229.62, 3);
		expect(qwen?.outputSpeedSource).toBe("api");
		expect(second.notes).toContain(
			`migrated 1 api-tier speeds and 1 scores from ${mpcStorePath()}`,
		);
		// Another tool's file is read, never rewritten or deleted.
		expect(readFileSync(mpcStorePath(), "utf8")).toBe(LEGACY);
		const saved = storeModels().find((model) => model.slug === "qwen3-5-omni-plus");
		expect(saved?.outputSpeedSource).toBe("api");
		const snapshot = storeModels();

		const third = await loadCatalogue({ cacheTtlMs: 0 });
		expect(third.notes.some((note) => note.includes("migrated"))).toBe(false);
		expect(pick(third.models)).toEqual(pick(second.models));
		expect(storeModels()).toEqual(snapshot);
	});

	test("a malformed or absent legacy file is a no-op", async () => {
		stubFetch(healthy);
		await loadCatalogue({ cacheTtlMs: 0 });
		writeFileSync(mpcStorePath(), "{oops");
		const after = await loadCatalogue({ cacheTtlMs: 0 });
		expect(after.notes.some((note) => note.includes("migrated"))).toBe(false);
		expect(pick(after.models)?.outputSpeedSource).toBe("page");
		rmSync(mpcStorePath());
		const absent = await loadCatalogue({ cacheTtlMs: 0 });
		expect(absent.notes.some((note) => note.includes("migrated"))).toBe(false);
	});

	test("a cached replay does not re-announce the migration", async () => {
		stubFetch(healthy);
		await loadCatalogue({ cacheTtlMs: 3_600_000 });
		writeFileSync(mpcStorePath(), LEGACY);
		const migrated = await loadCatalogue({ cacheTtlMs: 3_600_000, refresh: true });
		expect(migrated.notes.some((note) => note.startsWith("migrated"))).toBe(true);
		const cached = await loadCatalogue({ cacheTtlMs: 3_600_000 });
		expect(cached.notes.some((note) => note.includes("migrated"))).toBe(false);
		expect(pick(cached.models)?.outputSpeedSource).toBe("api");
	});

	test("a degraded run repairs the fallback without restamping its age", async () => {
		const age = Date.now() - 6 * 3_600_000;
		writeFileSync(
			lastGoodPath(),
			JSON.stringify({
				fetchedAt: age,
				models: [
					stored("glm-5-3", {
						keys: ["glm53"],
						outputSpeed: 73.09,
						outputSpeedSource: "page",
					}),
				],
			}),
		);
		writeFileSync(mpcStorePath(), JSON.stringify({ fetchedAt: age, tps: [["glm53", 72.85]] }));
		stubFetch(() => {
			throw new Error("offline");
		});
		const stale = await loadCatalogue({ cacheTtlMs: 0 });
		expect(stale.stale).toBe(true);
		expect(stale.notes.some((note) => note.startsWith("migrated 1 api-tier speed"))).toBe(true);
		const file = JSON.parse(readFileSync(lastGoodPath(), "utf8")) as Record<string, unknown>;
		expect(file.fetchedAt).toBe(age);
		expect((file.models as Array<Record<string, unknown>>)[0]?.outputSpeedSource).toBe("api");
	});
});
