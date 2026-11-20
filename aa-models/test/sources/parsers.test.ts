import { describe, expect, test } from "bun:test";
import { normalizeRows } from "#~/model.ts";
import { parseAaApi } from "#~/sources/api.ts";
import { decodeFlight, readArray } from "#~/sources/flight.ts";
import { parseLeaderboardHtml, parseModelsHtml } from "#~/sources/leaderboard.ts";
import { aaPage, readRows } from "./page.ts";

const leaderboard = aaPage(readRows("leaderboard.rows.json"));
const modelsPage = aaPage(readRows("models.rows.json"));

describe("flight payload", () => {
	test("decodes the escaped RSC chunk into plain keys", () => {
		const flight = JSON.stringify({ initialModels: [{ name: "A]B", n: 1 }] });
		const html = `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`;
		expect(decodeFlight(html)).toContain('"initialModels":');
		expect(readArray(decodeFlight(html), "initialModels")).toEqual([{ name: "A]B", n: 1 }]);
	});

	test("a missing key is null, not a throw", () => {
		expect(readArray('{"other":[]}', "initialModels")).toBeNull();
	});
});

describe("leaderboard page", () => {
	const models = parseLeaderboardHtml(leaderboard);
	const claude = models.find((model) => model.slug === "claude-sonnet-5-5");

	test("effort variants fold into their release slug", () => {
		expect(models).toHaveLength(3);
		expect(claude?.intelligenceIndex).toBe(49.9240327787242);
		expect(claude?.variants).toHaveLength(2);
		expect(claude?.reasoning.efforts).toContain("Medium, Default Fallback");
		expect(claude?.keys).toContain("claudesonnet55");
	});

	test("a null index stays null while speed still lands", () => {
		const jt = models.find((model) => model.slug === "jt-35b-flash");
		const qwen = models.find((model) => model.slug === "qwen3-5-omni-plus");
		expect(jt?.intelligenceIndex).toBeNull();
		expect(jt?.outputSpeed).toBeNull();
		expect(qwen?.intelligenceIndex).toBeNull();
		expect(qwen?.outputSpeed).toBeCloseTo(63.3744, 3);
	});

	test("price, context, latency and provenance come from the published fields", () => {
		expect(claude?.price).toEqual({ input: 2, output: 10, blended: null });
		expect(claude?.contextWindow).toBe(1_000_000);
		expect(claude?.latency).toBeCloseTo(28.8575, 3);
		expect(claude?.creator).toBe("Anthropic");
		expect(claude?.openWeights).toBe(false);
		expect(claude?.sources).toEqual(["leaderboard"]);
		expect(claude?.evals["scores.aa-briefcase"]).toBe(1739.19);
	});

	test("an empty page yields no models", () => {
		expect(parseLeaderboardHtml("<html></html>")).toEqual([]);
	});
});

describe("models page", () => {
	const models = parseModelsHtml(modelsPage);
	const mimo = models.find((model) => model.slug === "mimo-v2-6-pro");

	test("carries the published price, blended rate and latency", () => {
		expect(mimo?.price).toEqual({ input: 0.435, output: 0.87, blended: 0.54375 });
		expect(mimo?.outputSpeed).toBeCloseTo(54.9322, 3);
		expect(mimo?.latency).toBeCloseTo(4.1677, 3);
		expect(mimo?.evals["headline.outputSpeed"]).toBeCloseTo(54.9322, 3);
	});

	test("modalities and creator come from the flags, text implied", () => {
		expect(mimo?.modalities.input).toEqual(["text", "image", "speech", "video"]);
		expect(mimo?.modalities.output).toEqual(["text"]);
		expect(mimo?.creator).toBe("Xiaomi");
		expect(mimo?.sources).toEqual(["models"]);
	});

	test("nested scalars keep their parent in the eval path", () => {
		expect(mimo?.evals["capabilities.financeAndAccounting"]).toBeCloseTo(38.926, 3);
		expect(mimo?.evals["gdpvalInterval.lower"]).toBeDefined();
		expect(mimo?.evals["intelligenceIndexCost.total"]).toBeDefined();
		expect(Object.keys(mimo?.evals ?? {}).every((path) => path.length > 0)).toBe(true);
	});
});

describe("api page", () => {
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

	test("digs the index and speed out of their nested keys", () => {
		const { models } = parseAaApi(body);
		const opus = models.find((model) => model.slug === "claude-opus-5-5");
		expect(opus?.intelligenceIndex).toBeCloseTo(57.6, 2);
		expect(opus?.outputSpeed).toBeCloseTo(88.4, 2);
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
