import { describe, expect, test } from "bun:test";
import od from "../../../core/od.json";
import { OD_PUBLISHED_ROWS } from "#~/data/sources/od/od.generated.ts";

/** The fields the packaged table must carry verbatim, not just a row count. */
const FIELDS = ["input", "output", "cacheRead", "cacheWrite", "longContext", "rateSource"] as const;

type SourceRow = (typeof od.models)[number];
type PackagedRow = (typeof OD_PUBLISHED_ROWS)[number];

/** Actual-value diff, keyed by model id and field. Empty means fully in sync. */
function drift(source: readonly SourceRow[], packaged: readonly PackagedRow[]): string[] {
	const byId = new Map(packaged.map((row) => [row.id, row]));
	const found: string[] = [];
	if (source.length !== packaged.length) {
		found.push(`row count ${packaged.length} != ${source.length}`);
	}
	for (const row of source) {
		const copy = byId.get(row.id);
		if (!copy) {
			found.push(`missing packaged row ${row.id}`);
			continue;
		}
		for (const field of FIELDS) {
			const want = (row as Record<string, unknown>)[field];
			const got = (copy as unknown as Record<string, unknown>)[field];
			if (JSON.stringify(got) !== JSON.stringify(want)) {
				found.push(`${row.id}.${field}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
			}
		}
		if (copy.multiplier !== row.multiplier) {
			found.push(`${row.id}.multiplier: ${copy.multiplier} != ${row.multiplier}`);
		}
		if (copy.label !== row.label) found.push(`${row.id}.label: ${copy.label} != ${row.label}`);
	}
	return found;
}

describe("packaged OpenDesign rates", () => {
	test("the shipped table matches every value in core/od.json", () => {
		expect(drift(od.models, OD_PUBLISHED_ROWS)).toEqual([]);
	});

	test("the drift check notices a single edited rate, cache tier or provenance", () => {
		const altered = structuredClone(od.models) as SourceRow[];
		const flash = altered.find((row) => row.id === "deepseek-v4.1-flash");
		const haiku = altered.find((row) => row.id === "claude-haiku-5.5");
		if (!flash || !haiku) throw new Error("fixture rows missing from core/od.json");
		flash.input += 0.01;
		haiku.cacheWrite = 9;
		haiku.rateSource = "estimate";
		if (haiku.longContext) haiku.longContext.input = 9;
		const found = drift(altered, OD_PUBLISHED_ROWS);
		for (const key of [
			"deepseek-v4.1-flash.input",
			"claude-haiku-5.5.cacheWrite",
			"claude-haiku-5.5.rateSource",
			"claude-haiku-5.5.longContext",
		]) {
			expect(
				found.some((line) => line.startsWith(`${key}:`)),
				`no diff for ${key}`,
			).toBe(true);
		}
	});

	test("row count alone is not the proof", () => {
		const sameCount = structuredClone(od.models) as SourceRow[];
		const first = sameCount[0];
		if (!first) throw new Error("no rows in core/od.json");
		first.output += 1;
		expect(sameCount).toHaveLength(OD_PUBLISHED_ROWS.length);
		expect(drift(sameCount, OD_PUBLISHED_ROWS).length).toBeGreaterThan(0);
	});

	test("the committed generated file is what the generator emits", () => {
		const root = new URL("../../..", import.meta.url).pathname;
		const script = new URL("../../../scripts/extract-od-rates.ts", import.meta.url).pathname;
		const result = Bun.spawnSync({ cmd: ["bun", script, "--check"], cwd: root });
		const output =
			new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
		expect(result.exitCode, output).toBe(0);
	});
});
