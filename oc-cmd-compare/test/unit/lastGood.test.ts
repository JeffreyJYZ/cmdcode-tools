import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrate, lastGoodPath, readLastGood, writeLastGood } from "#~/data/sources/aa/lastGood.ts";

describe("AA last-good cache", () => {
	test("round-trips a scored payload", async () => {
		process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "mpc-lg-"));
		await writeLastGood({
			indexVersion: "v5.0.1",
			intelligence: new Map([["deepseekv41flash", 32.6]]),
			tps: new Map([["deepseekv41flash", 251]]),
		});
		const cached = await readLastGood();
		expect(cached?.indexVersion).toBe("v5.0.1");
		if (!cached) throw new Error("no cached payload");
		const data = hydrate(cached);
		expect(data.intelligence.get("deepseekv41flash")).toBe(32.6);
		expect(data.tps.get("deepseekv41flash")).toBe(251);
	});

	test("never persists an empty answer", async () => {
		process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "mpc-lg-"));
		await writeLastGood({ intelligence: new Map(), tps: new Map() });
		expect(existsSync(lastGoodPath())).toBe(false);
		expect(await readLastGood()).toBeUndefined();
	});
});
