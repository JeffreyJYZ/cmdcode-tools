import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRows } from "#~/model.ts";
import { mergeModels } from "#~/sources/normalize.ts";

const manifest = JSON.parse(
	readFileSync(join(import.meta.dir, "fixtures", "manifest.rows.json"), "utf8"),
) as { models: unknown[] };

describe("manifest rows", () => {
	const models = normalizeRows(manifest.models, "manifest");
	const scored = models.find((model) => model.slug === "claude-sonnet-5-5");
	const unscored = models.find((model) => model.slug === "glm-4-5v");

	test("identity is the release slug, not the effort variant slug", () => {
		expect(models).toHaveLength(2);
		expect(scored?.release.date).toBe("2026-09-28");
		expect(scored?.reasoning.efforts).toEqual(["medium"]);
		expect(scored?.sources).toEqual(["manifest"]);
	});

	test("a row with no index stays null and its other scalars land in evals", () => {
		expect(unscored?.intelligenceIndex).toBeNull();
		expect(unscored?.evals.score).toBeCloseTo(166.444, 2);
		expect(scored?.evals.score).toBeCloseTo(319.754, 2);
	});
});

describe("mergeModels", () => {
	const base = normalizeRows(
		[{ slug: "deepseek-v4-1-flash-1017", name: "DeepSeek V4.1 Flash", intelligenceIndex: 32 }],
		"manifest",
	);
	const richer = normalizeRows(
		[
			{
				slug: "deepseek-v4-1-flash-1017",
				name: "DeepSeek V4.1 Flash",
				intelligenceIndex: 30,
				outputSpeed: 40,
				contextWindowTokens: 128_000,
				price1mInputTokens: 0.15,
			},
		],
		"leaderboard",
	);

	test("a later lower score never overwrites a higher one", () => {
		const [merged] = mergeModels([base, richer]);
		expect(merged?.intelligenceIndex).toBe(32);
	});

	test("first non-null scalars fill in from the other source", () => {
		const [merged] = mergeModels([base, richer]);
		expect(merged?.outputSpeed).toBe(40);
		expect(merged?.contextWindow).toBe(128_000);
		expect(merged?.price?.input).toBe(0.15);
		expect(merged?.sources).toEqual(["manifest", "leaderboard"]);
	});

	test("a shared join key merges models from different sources", () => {
		const one = normalizeRows([{ slug: "tencent-hy4", name: "Tencent Hy4" }], "api");
		const other = normalizeRows(
			[{ slug: "tencent-hy4-0901", name: "Tencent Hy4", intelligenceIndex: 34 }],
			"leaderboard",
		);
		expect(other[0]?.keys).toContain("hy4");
		const merged = mergeModels([one, other]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.slug).toBe("tencent-hy4");
		expect(merged[0]?.intelligenceIndex).toBe(34);
		expect(merged[0]?.keys).toContain("hy4");
	});

	test("a shared key never folds two rows one source listed apart", () => {
		const dated = normalizeRows(
			[
				{ slug: "deepseek-v3-2", name: "DeepSeek V3.2" },
				{ slug: "deepseek-v3-2-0925", name: "DeepSeek V3.2" },
			],
			"manifest",
		);
		expect(dated).toHaveLength(2);
		expect(mergeModels([dated])).toHaveLength(2);
	});
});
