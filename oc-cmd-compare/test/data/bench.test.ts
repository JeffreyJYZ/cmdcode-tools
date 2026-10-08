import { describe, expect, test } from "bun:test";
import { parseAaApi } from "~/data/sources/aa/parse.ts";
import { parseAaWeb } from "~/data/sources/aa/web.ts";

// Mirrors the shape Artificial Analysis embeds in its models page flight data.
const AA_FIXTURE = `<script>{"citation":"Artificial Analysis (2025). LLM benchmarks dataset.","data":[{"label":"Claude Opus 5.5 (max with fallback)","intelligenceIndex":57.62,"detailsUrl":"/models/claude-opus-5-5"},{"label":"GLM-5.3-Flash","intelligenceIndex":30.5,"detailsUrl":"/models/glm-5-3-flash"},{"label":"Qwen3.8 Max (0902)","intelligenceIndex":41.1,"detailsUrl":"/models/qwen3-8-max-0902"}]}</script>`;

describe("parseAaWeb", () => {
	test("maps slugs and labels onto canonical keys", () => {
		const scores = parseAaWeb(AA_FIXTURE);
		expect(scores.get("claudeopus55")).toBeCloseTo(57.62, 2);
		expect(scores.get("glm53flash")).toBeCloseTo(30.5, 2);
		// Variant suffix in the label must not leak; slug keeps the 0902 variant.
		expect(scores.get("qwen38max0902")).toBeCloseTo(41.1, 2);
	});

	test("empty when no dataset present", () => {
		expect(parseAaWeb("<html></html>").size).toBe(0);
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
