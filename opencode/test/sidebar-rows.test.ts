import { describe, expect, test } from "bun:test";
import {
	count,
	modelKey,
	modelRows,
	money,
	parts,
	pctTone,
	rate,
	separator,
	tierFor,
	until,
	usageRows,
} from "../src/sidebar/rows";
import { elapsedLabel } from "../src/sidebar/windows";

describe("formatting", () => {
	test("money trims whole numbers but keeps cents", () => {
		expect(money(60)).toBe("$60");
		expect(money(12.5)).toBe("$12.50");
		expect(money(0.125)).toBe("$0.13");
	});
	test("rate keeps sub-cent precision", () => {
		expect(rate(0)).toBe("$0");
		expect(rate(0.0036)).toBe("$0.0036");
		expect(rate(0.6)).toBe("$0.6");
	});
	test("count abbreviates", () => {
		expect(count(940)).toBe("940");
		expect(count(6_296)).toBe("6.3K");
		expect(count(2_400_000)).toBe("2.4M");
	});
	test("until renders a short countdown", () => {
		const now = 1_000_000_000_000;
		expect(until(now + 30_000, now)).toBe("<1m");
		expect(until(now + 5 * 60_000, now)).toBe("5m");
		expect(until(now + 3 * 3_600_000 + 12 * 60_000, now)).toBe("3h 12m");
		expect(until(now + 44 * 3_600_000, now)).toBe("1d 20h");
		expect(until(undefined, now)).toBe("");
	});
});

describe("usageRows", () => {
	const usage = {
		plan: "GOAT",
		monthlyCap: 70,
		monthlyCredits: 19.44,
		fiveHour: { cap: 14, used: 1.17, resetAt: 1_000_000_000_000 },
		weekly: { cap: 35, used: 12.43, resetAt: 1_000_000_000_000 },
		requests: 6_296,
		cost: 46.31,
	};
	test("renders plan, monthly, windows and period", () => {
		const rows = usageRows(usage, 1_000_000_000_000 - 5 * 60_000);
		expect(rows[0]).toEqual(["Plan", "GOAT · $70/mo credits", "base"]);
		expect(rows[1]).toEqual(["Monthly", "$50.56 / $70 (72%)", "warn"]);
		expect(rows[2]).toEqual(["5-hour", "$1.17/$14 (8%)", "ok"]);
		expect(rows[3]?.[0]).toBe("");
		expect(rows[3]?.[1]).toContain("elapsed");
		expect(rows[3]?.[1]).toContain("resets 5m");
		expect(rows[3]?.[2]).toBe("muted");
		expect(rows[4]?.[0]).toBe("Weekly");
		expect(rows[6]).toEqual(["Period", "6.3K requests · $46.31", "base"]);
	});
	test("monthly is a billing period: resets and elapsed from its bounds", () => {
		const startAt = Date.UTC(2026, 7, 27, 12, 23);
		const endAt = Date.UTC(2026, 8, 27, 12, 23); // 31 days later
		const now = endAt - (3 * 60 + 50) * 60_000; // 3h 50m left
		const rows = usageRows(
			{
				plan: "GOAT",
				monthlyCap: 70,
				monthlyCredits: 12.68,
				periodStartAt: startAt,
				periodEndAt: endAt,
			},
			now,
		);
		expect(rows[1]).toEqual(["Monthly", "$57.32 / $70 (82%)", "warn"]);
		expect(rows[2]).toEqual(["", "99% elapsed · resets 3h 50m", "muted"]);
	});
	test("monthly keeps to spend when cmduse has no period bounds", () => {
		const rows = usageRows({
			plan: "GOAT",
			monthlyCap: 70,
			monthlyCredits: 12.68,
		});
		expect(rows[1]?.[0]).toBe("Monthly");
		// Plan + Monthly only: no continuation without the bounds.
		expect(rows.length).toBe(2);
	});
	test("clamps used into the cap when credits exceed it", () => {
		const rows = usageRows({
			plan: "GOAT",
			monthlyCap: 70,
			monthlyCredits: 84.5,
		});
		expect(rows[1]).toEqual(["Monthly", "$0 / $70 (0%)", "ok"]);
	});
	test("omits elapsed when the window has not started", () => {
		const notStarted = {
			...usage,
			fiveHour: { cap: 14, used: 1, resetAt: 1_000_000_000_000 + 6 * 3600_000 },
		};
		const rows = usageRows(notStarted, 1_000_000_000_000);
		expect(rows[2]?.[1]).not.toContain("elapsed");
	});
	test("empty input yields no rows", () => {
		expect(usageRows(undefined)).toEqual([]);
	});
});

describe("modelRows", () => {
	test("renders tier, allowance, rates and benchmarks", () => {
		const rows = modelRows({
			key: "deepseekv41flash",
			name: "DeepSeek V4.1 Flash",
			tier: "opensource",
			allowance: 60,
			rates: { input: 0.15, output: 0.6, cacheRead: 0.003 },
			intelligence: 39.5,
			tps: 247,
		});
		expect(rows[0]).toEqual(["Model", "DeepSeek V4.1 Flash", "strong"]);
		expect(rows[1]).toEqual(["Tier", "open source", "base"]);
		expect(rows[2]).toEqual(["Allowance", "$60/mo", "base"]);
		expect(rows[3]).toEqual(["Rates", "$0.15/$0.6 in/out", "base"]);
		expect(rows[4]).toEqual(["", "cache read $0.003", "muted"]);
		expect(rows[5]).toEqual(["Intelligence", "39.5", "base"]);
		expect(rows[6]).toEqual(["Tok/s", "247", "base"]);
	});
	test("adds cache write only when the model has one", () => {
		const claude = modelRows({
			key: "claudesonnet5",
			name: "Claude Sonnet 5",
			rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
		});
		expect(claude[1]).toEqual(["Rates", "$2/$10 in/out", "base"]);
		expect(claude[2]).toEqual(["", "cache read $0.2 · write $2.5", "muted"]);
	});
	test("puts period usage under the model name when known", () => {
		const rows = modelRows(
			{ key: "deepseekv41flash", name: "DeepSeek V4.1 Flash" },
			{ requests: 1_234, cost: 8.4 },
		);
		expect(rows[0]).toEqual(["Model", "DeepSeek V4.1 Flash", "strong"]);
		expect(rows[1]).toEqual(["Usage (this model)", "1.2K req · $8.40", "base"]);
	});
	test("omits spend when the harness priced it at zero (subscription)", () => {
		const rows = modelRows(
			{ key: "deepseekv41flash", name: "DeepSeek V4.1 Flash" },
			{ requests: 3_110, cost: 0 },
		);
		expect(rows[1]).toEqual(["Usage (this model)", "3.1K req", "base"]);
	});
	test("missing meta yields no rows", () => {
		expect(modelRows(undefined)).toEqual([]);
	});
});

describe("tones", () => {
	test("severity steps at 70% and 90%", () => {
		expect(pctTone(0)).toBe("ok");
		expect(pctTone(69)).toBe("ok");
		expect(pctTone(70)).toBe("warn");
		expect(pctTone(89)).toBe("warn");
		expect(pctTone(90)).toBe("crit");
		expect(pctTone(140)).toBe("crit");
	});
	test("the rule and continuations are muted, the model name is bold", () => {
		expect(separator()[2]).toBe("muted");
		const rows = usageRows(
			{
				plan: "GOAT",
				monthlyCap: 70,
				monthlyCredits: 4.2,
				fiveHour: { cap: 14, used: 13.9, resetAt: Date.now() + 3_600_000 },
			},
			Date.now(),
		);
		// 94% of the month and 99% of the window are both over the line.
		expect(rows[1]?.[2]).toBe("crit");
		expect(rows[2]?.[2]).toBe("crit");
	});
	test("parts splits label from value for the panel", () => {
		expect(parts(["Tier", "open source", "base"])).toEqual([
			"Tier: ",
			"open source",
		]);
		expect(parts(["", "cache read $0.003", "muted"])).toEqual([
			"  cache read $0.003",
			"",
		]);
		expect(parts(["Command Code", "", "muted"])).toEqual(["Command Code", ""]);
	});
});

describe("tierFor", () => {
	test("reads the gating categories by model id", () => {
		expect(tierFor("deepseek/deepseek-v4-flash")).toBe("opensource");
		expect(tierFor("claude-sonnet-5")).toBe("premium");
		expect(tierFor("nope/nothing")).toBeUndefined();
	});
});

describe("modelKey", () => {
	test("mirrors mpc's normalization", () => {
		expect(modelKey("deepseek/deepseek-v4.1-flash")).toBe("deepseekv41flash");
		expect(modelKey("DeepSeek V4 Flash (latest)")).toBe("deepseekv4flash");
		expect(modelKey("zai-org/GLM-5.2-Fast")).toBe("glm52fast");
	});
});

describe("elapsedLabel", () => {
	const fiveHour = 5 * 3600;
	test("a window minutes into a long period reads <1%, not 0%", () => {
		// 40 minutes into a 7-day window
		const resetAt = 1_000_000 + 7 * 86_400 - 2400;
		expect(elapsedLabel(resetAt * 1000, 7 * 86_400, 1_000_000)).toBe("<1%");
	});
	test("exactly at the start stays 0%, and real percents round", () => {
		const resetAt = 1_000_000 + fiveHour;
		expect(elapsedLabel(resetAt * 1000, fiveHour, 1_000_000)).toBe("0%");
		expect(elapsedLabel(resetAt * 1000, fiveHour, 1_000_000 + 13 * 60)).toBe(
			"4%",
		);
	});
	test("no reset time means no label", () => {
		expect(elapsedLabel(undefined, fiveHour, 1_000_000)).toBeUndefined();
	});
});

describe("min plan row", () => {
	test("shows the cheapest plan that serves the model", () => {
		const rows = modelRows({
			key: "k",
			name: "DeepSeek V4.1 Flash",
			minPlan: "Go",
		});
		expect(rows[1]).toEqual(["Min plan", "Go", "base"]);
	});
	test("omits the row when the catalog has no answer", () => {
		const rows = modelRows({ key: "k", name: "x", minPlan: null });
		expect(rows.some(([label]) => label === "Min plan")).toBe(false);
	});
});

describe("min plan is a fallback, not a second opinion", () => {
	test("tier wins and min plan is omitted when both are known", () => {
		const rows = modelRows({
			key: "k",
			name: "DeepSeek V4.1 Flash",
			tier: "opensource",
			minPlan: "Go",
		});
		expect(rows.map(([label]) => label)).not.toContain("Min plan");
		expect(rows.map(([label]) => label)).toContain("Tier");
	});
	test("min plan fills in when the snapshot has no tier", () => {
		const rows = modelRows({ key: "k", name: "New Model", minPlan: "Pro" });
		expect(rows.map(([label, value]) => [label, value])).toContainEqual([
			"Min plan",
			"Pro",
		]);
	});
});
