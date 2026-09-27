import { describe, expect, test } from "bun:test";
import {
	clip,
	type ModelMeta,
	modelRows,
	ROW_WIDTH,
	rowWidth,
	separator,
	usageRows,
} from "../src/sidebar/rows";

/** The panel draws `label: value`, continuation rows as two spaces + value. */
const render = (row: [string, string]) =>
	row[0] === "" ? `  ${row[1]}` : row[1] ? `${row[0]}: ${row[1]}` : row[0];

const usage = (over: Partial<Parameters<typeof usageRows>[0]> = {}) => ({
	plan: "GOAT",
	monthlyCap: 70,
	monthlyCredits: 14.62,
	fiveHour: { cap: 14, used: 0.55, resetAt: Date.now() + 4.8 * 3_600_000 },
	weekly: { cap: 35, used: 18.46, resetAt: Date.now() + 21.7 * 3_600_000 },
	requests: 7_300,
	cost: 55.29,
	...over,
});

describe("sidebar rows fit the panel", () => {
	test("rowWidth matches what the panel draws", () => {
		expect(render(["Tier", "open source"])).toBe("Tier: open source");
		expect(render(["", "4% elapsed"])).toBe("  4% elapsed");
		expect(render([separator()[0], ""])).toHaveLength(ROW_WIDTH);
		expect(rowWidth(["Tier", "open source"])).toBe(17);
		expect(rowWidth(["", "4% elapsed"])).toBe(12);
	});

	test("every row of the reported sidebar fits", () => {
		const rows = [
			...usageRows(usage()),
			separator(),
			...modelRows(
				{
					key: "deepseekv41flash",
					name: "DeepSeek V4.1 Flash",
					tier: "opensource",
					allowance: 60,
					rates: { input: 0.15, output: 0.6, cacheRead: 0.003 },
					intelligence: 39.5,
					tps: 237,
				},
				{ requests: 2_100, cost: 0 },
			),
		];
		for (const row of rows) {
			expect(rowWidth(row)).toBeLessThanOrEqual(ROW_WIDTH);
			expect(render(row).length).toBeLessThanOrEqual(ROW_WIDTH);
		}
		// The two rows that used to overflow (53 and 57 columns) are split.
		expect(rows.map((row) => row[0])).toContain("5-hour");
		expect(rows.filter((row) => row[0] === "").length).toBeGreaterThanOrEqual(
			3,
		);
	});

	test("fits the awkward cases: claude cache write, long name, big money", () => {
		const claude: ModelMeta = {
			key: "claudesonnet5",
			name: "Claude Sonnet 5 (Anthropic, extended thinking variant)",
			rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
			allowance: 150,
		};
		const big = usage({
			monthlyCap: 20_000,
			monthlyCredits: 123.45,
			fiveHour: {
				cap: 1_800,
				used: 1_234.56,
				resetAt: Date.now() + 59 * 60_000,
			},
			weekly: {
				cap: 9_000,
				used: 8_765.43,
				resetAt: Date.now() + 6.9 * 86_400_000,
			},
			requests: 1_234_567,
			cost: 12_345.67,
		});
		for (const row of [
			...usageRows(big),
			...modelRows(claude, { requests: 1_234_567, cost: 99.5 }),
		]) {
			expect(render(row).length).toBeLessThanOrEqual(ROW_WIDTH);
		}
	});

	test("clip keeps the width and marks the cut", () => {
		expect(clip("short")).toBe("short");
		const long = clip("a".repeat(60));
		expect(long).toHaveLength(ROW_WIDTH);
		expect(long.endsWith("…")).toBe(true);
	});
});
