import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "#~/cli/run.ts";
import { CACHE_SCHEMA, LOADER_REVISION, cachePath } from "#~/sources/cache.ts";
import { lastGoodPath } from "#~/sources/lastGood.ts";
import { aaPage, readRows } from "../sources/page.ts";
import { captureConsole } from "./fixture.ts";

const leaderboard = aaPage(readRows("leaderboard.rows.json"));
const realFetch = globalThis.fetch;

/** A file no build of this one would serve, but a load would happily overwrite. */
const FORGED = JSON.stringify({
	schema: CACHE_SCHEMA,
	revision: "0",
	version: "0.1.0",
	fetchedAt: new Date().toISOString(),
	models: [{ slug: "forged-only", name: "Forged" }],
	sources: ["manifest"],
	indexVersion: null,
	notes: [],
});

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-run-"));
	process.env.AA_CACHE_DIR = dir;
	globalThis.fetch = (() =>
		Promise.resolve(new Response(leaderboard))) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.AA_CACHE_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe("aam check dispatch", () => {
	/**
	 * `check` reloads cache-less and then reports the file a default run would read.
	 * Its dispatch load must not write first, or a poisoned cache is repaired before
	 * the diagnostic can name what was wrong with it.
	 */
	test("leaves a forged cache file for the diagnostic to report", async () => {
		writeFileSync(cachePath(), FORGED);
		const { out, restore } = captureConsole();
		try {
			expect(await run(["check"])).toBe(0);
			const text = out.join("\n");
			expect(text).toContain(`revision 0 (current ${LOADER_REVISION}) · ignored`);
			expect(text).not.toContain("forged-only");
		} finally {
			restore();
		}
		expect(readFileSync(cachePath(), "utf8")).toBe(FORGED);
	});

	/**
	 * The reload has to leave the failure fallback alone too: a diagnostic that
	 * rewrites `last-good.json` destroys the only evidence of what a broken run
	 * would have replayed.
	 */
	test("leaves a forged last-good file untouched", async () => {
		const forged = JSON.stringify({
			fetchedAt: 1,
			models: [{ slug: "forged-only", name: "Forged" }],
		});
		writeFileSync(lastGoodPath(), forged);
		const { out, restore } = captureConsole();
		try {
			expect(await run(["check"])).toBe(0);
			expect(out.join("\n")).toContain("coverage");
		} finally {
			restore();
		}
		expect(readFileSync(lastGoodPath(), "utf8")).toBe(forged);
	});
});
