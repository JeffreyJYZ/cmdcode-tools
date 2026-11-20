import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import {
	CACHE_SCHEMA,
	LOADER_REVISION,
	cachePath,
	inspectCache,
	readCache,
	writeCache,
} from "#~/sources/cache.ts";
import { catalogue, model } from "../cli/fixture.ts";

const MODELS = [model({ slug: "glm-5-3", intelligenceIndex: 60 })];
const fresh = () => ({
	...catalogue(MODELS),
	notes: [],
	fetchedAt: new Date().toISOString(),
});
const STORED = fresh();
const TTL = 3_600_000;

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-cache-"));
	process.env.AA_CACHE_DIR = dir;
});

afterEach(() => {
	delete process.env.AA_CACHE_DIR;
	rmSync(dir, { recursive: true, force: true });
});

/** A cache file written by hand, so a test can forge any identity it needs. */
function forge(overrides: Record<string, unknown>): void {
	writeFileSync(cachePath(), JSON.stringify({ ...STORED, ...overrides }));
}

describe("cache identity", () => {
	test("a file this build wrote is served and labelled", async () => {
		await writeCache(STORED);
		const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as Record<string, unknown>;
		expect(parsed.schema).toBe(CACHE_SCHEMA);
		expect(parsed.revision).toBe(LOADER_REVISION);
		expect(parsed.version).toBe(pkg.version);
		const hit = await readCache(TTL);
		expect(hit?.models).toHaveLength(1);
		expect(hit?.notes.some((note) => note.startsWith("cache: 1 models"))).toBe(true);
		expect((await inspectCache(TTL)).usable).toBe(true);
	});

	test("a stale revision is ignored, not migrated", async () => {
		forge({ schema: CACHE_SCHEMA, revision: "0", version: pkg.version });
		expect(await readCache(TTL)).toBeNull();
		const state = await inspectCache(TTL);
		expect(state.usable).toBe(false);
		expect(state.reason).toContain(`revision 0 (current ${LOADER_REVISION})`);
	});

	test("an older schema is ignored even with the right revision", async () => {
		forge({ schema: "aa-models/1", revision: LOADER_REVISION, version: pkg.version });
		expect(await readCache(TTL)).toBeNull();
		expect((await inspectCache(TTL)).reason).toContain("schema aa-models/1");
	});

	test("a payload with no models is never served", async () => {
		forge({ ...STORED, schema: CACHE_SCHEMA, revision: LOADER_REVISION, models: [] });
		expect(await readCache(TTL)).toBeNull();
		expect((await inspectCache(TTL)).reason).toBe("carries no models");
	});

	test("an empty catalogue is never written", async () => {
		await writeCache({ ...STORED, models: [] });
		expect(existsSync(cachePath())).toBe(false);
	});

	test("a file older than the TTL is not served", async () => {
		forge({
			schema: CACHE_SCHEMA,
			revision: LOADER_REVISION,
			fetchedAt: new Date(Date.now() - 7_200_000).toISOString(),
		});
		expect(await readCache(TTL)).toBeNull();
		expect((await inspectCache(TTL)).reason).toContain("older than the TTL");
	});

	test("no file at all reads as absent, never as an error", async () => {
		expect(await readCache(TTL)).toBeNull();
		const state = await inspectCache(TTL);
		expect(state.present).toBe(false);
		expect(state.usable).toBe(false);
	});
});
