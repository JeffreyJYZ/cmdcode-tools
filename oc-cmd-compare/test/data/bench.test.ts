import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAaApi } from "#~/data/sources/aa/parse.ts";
import { parseAaWeb } from "#~/data/sources/aa/web.ts";

// A trimmed but shape-faithful slice of the live page: the `initialModels`
// array sits in the Next.js RSC flight payload, so its quotes are escaped.
const AA_FIXTURE = readFileSync(join(import.meta.dir, "aa-web.html"), "utf8");

describe("parseAaWeb", () => {
	test("reads index and speed from the escaped flight payload", () => {
		const { intelligence, tps } = parseAaWeb(AA_FIXTURE);
		expect(intelligence.get("step5preview")).toBeCloseTo(43.73, 2);
		expect(intelligence.get("glm53flash")).toBeCloseTo(41.81, 2);
		expect(tps.get("step5preview")).toBeCloseTo(88.0, 1);
		expect(tps.get("glm53flash")).toBeCloseTo(57.5, 1);
		// The slug key resolves too (both the slug and the label are indexed).
		expect(intelligence.get("step5")).toBeCloseTo(43.73, 2);
		// A model with no published speed keeps its index but no tps.
		expect(intelligence.get("mistrallarge4")).toBeCloseTo(38.38, 2);
		expect(tps.has("mistrallarge4")).toBe(false);
	});

	test("empty when no dataset present", () => {
		const { intelligence, tps } = parseAaWeb("<html></html>");
		expect(intelligence.size).toBe(0);
		expect(tps.size).toBe(0);
	});
});

describe("parseAaApi", () => {
	const BODY = {
		pagination: { page: 1, page_size: 200, total_pages: 2, has_more: true },
		data: [
			{
				id: "abc",
				name: "Claude Opus 5.5 (max)",
				slug: "claude-opus-5-5",
				evaluations: { artificial_analysis_intelligence_index: 57.6 },
				performance: { median_output_tokens_per_second: 88.4 },
			},
			{
				name: "GLM-5.3 Flash (high)",
				slug: "glm-5-3-flash",
				evaluations: { artificial_analysis_intelligence_index: 30.5 },
				performance: { median_output_tokens_per_second: 114.9 },
			},
			{ name: "No Scores Here" },
		],
	};

	test("finds the index and speed regardless of nesting", () => {
		const { intelligence, tps } = parseAaApi(BODY);
		expect(intelligence.get("claudeopus55")).toBeCloseTo(57.6, 2);
		expect(intelligence.get("glm53flash")).toBeCloseTo(30.5, 2);
		expect(tps.get("claudeopus55")).toBeCloseTo(88.4, 2);
		expect(tps.get("glm53flash")).toBeCloseTo(114.9, 2);
		expect(intelligence.has("noscoresh")).toBe(false);
	});
});
