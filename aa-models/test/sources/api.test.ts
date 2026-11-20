import { describe, expect, test } from "bun:test";
import { normalizeRows } from "#~/model.ts";
import { parseAaApi } from "#~/sources/api.ts";

const body = {
	intelligence_index_version: "v5.0.1",
	pagination: { page: 1, page_size: 200, has_more: false },
	data: [
		{
			id: "abc",
			name: "Claude Opus 5.5 (max)",
			slug: "claude-opus-5-5",
			evaluations: { artificial_analysis_intelligence_index: 57.6 },
			performance: { median_output_tokens_per_second: 88.4 },
		},
		{
			name: "Unmeasured",
			slug: "unmeasured",
			evaluations: { artificial_analysis_intelligence_index: 0 },
		},
	],
};

describe("api page", () => {
	test("digs the index and speed out of their nested keys", () => {
		const { models } = parseAaApi(body);
		const opus = models.find((model) => model.slug === "claude-opus-5-5");
		expect(opus?.intelligenceIndex).toBeCloseTo(57.6, 2);
		expect(opus?.outputSpeed).toBeCloseTo(88.4, 2);
		// `performance.median_output_tokens_per_second` is the top tier of the
		// declared order, so no page figure may displace it.
		expect(opus?.outputSpeedSource).toBe("api");
		expect(opus?.keys).toContain("claudeopus55");
	});

	test("zero is unmeasured, never a score", () => {
		const { models } = parseAaApi(body);
		expect(models.find((model) => model.slug === "unmeasured")?.intelligenceIndex).toBeNull();
	});

	test("carries the in-band index version", () => {
		expect(parseAaApi(body).indexVersion).toBe("v5.0.1");
		expect(parseAaApi({ data: [] }).indexVersion).toBeNull();
	});

	test("a dated slug answers to both keys", () => {
		const [engine] = normalizeRows(
			[{ slug: "deepseek-v4-1-flash-1017-high", name: "DeepSeek V4.1 Flash (High)" }],
			"api",
		);
		expect(engine?.keys).toContain("deepseekv41flash1017high");
		expect(engine?.keys).toContain("deepseekv41flash");
	});
});
