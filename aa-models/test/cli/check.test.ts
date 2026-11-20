import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CheckDeps, runCheck, sourceRows } from "#~/cli/check.ts";
import { toOptions } from "#~/cli/map.ts";
import { parseArgv } from "#~/cli/parse.ts";
import { CACHE_SCHEMA, LOADER_REVISION, cachePath } from "#~/sources/cache.ts";
import type { Catalogue } from "#~/sources/index.ts";
import { catalogue, captureConsole, model } from "./fixture.ts";

const MODELS = [
	model({ slug: "glm-5-3", intelligenceIndex: 60 }),
	model({ slug: "kimi-k3", sources: ["manifest", "leaderboard"] }),
];
const LIVE = catalogue(MODELS);
const options = (...argv: string[]) => toOptions(parseArgv(argv));

/** A loader that answers the given catalogue and records what it was asked for. */
function stubLoader(live: Catalogue): CheckDeps & { calls: number } {
	const deps = {
		calls: 0,
		loadCatalogue: async () => {
			deps.calls += 1;
			return live;
		},
	};
	return deps;
}

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aa-check-"));
	process.env.AA_CACHE_DIR = dir;
});

afterEach(() => {
	delete process.env.AA_CACHE_DIR;
	rmSync(dir, { recursive: true, force: true });
});

/** A cache file this build would happily serve, holding one different model. */
function poisonedCache(): void {
	const cached = catalogue([model({ slug: "cached-only" })], {
		notes: [],
		fetchedAt: new Date().toISOString(),
	});
	writeFileSync(
		cachePath(),
		JSON.stringify({
			...cached,
			schema: CACHE_SCHEMA,
			revision: LOADER_REVISION,
			version: "0.1.0",
		}),
	);
}

describe("aam check", () => {
	test("counts each source that answered", () => {
		const rows = sourceRows(LIVE.models, LIVE.sources);
		expect(rows).toEqual([
			{ name: "manifest", count: 2 },
			{ name: "leaderboard", count: 1 },
		]);
	});

	test("exits 0 with per-source counts", async () => {
		const { out, restore } = captureConsole();
		try {
			expect(await runCheck(LIVE, options("check"), stubLoader(LIVE))).toBe(0);
			expect(out.join("\n")).toMatch(/manifest\s+2 models/);
			expect(out.join("\n")).toMatch(/leaderboard\s+1 models/);
		} finally {
			restore();
		}
	});

	test("reports the source, not a valid cache a default run would serve", async () => {
		poisonedCache();
		const deps = stubLoader(LIVE);
		const { out, restore } = captureConsole();
		try {
			expect(await runCheck(LIVE, options("check"), deps)).toBe(0);
			const text = out.join("\n");
			expect(deps.calls).toBe(1);
			expect(text).toMatch(/manifest\s+2 models/);
			expect(text).not.toContain("cached-only");
			expect(text).toContain(cachePath());
			expect(text).toContain("served");
		} finally {
			restore();
		}
	});

	test("names an ignored cache and why", async () => {
		writeFileSync(cachePath(), JSON.stringify({ schema: CACHE_SCHEMA, revision: "0" }));
		const { out, restore } = captureConsole();
		try {
			await runCheck(LIVE, options("check"), stubLoader(LIVE));
			expect(out.join("\n")).toContain(`revision 0 (current ${LOADER_REVISION}) · ignored`);
		} finally {
			restore();
		}
	});

	test("exits 1 when no source produced a model", async () => {
		const empty = catalogue([], { sources: [], indexVersion: null });
		const { restore } = captureConsole();
		try {
			expect(await runCheck(empty, options("check"), stubLoader(empty))).toBe(1);
		} finally {
			restore();
		}
	});
});
