import { describe, expect, test } from "bun:test";
import type { ModelMeta } from "../src/sidebar/rows";
import { parseZenJson, zenRows } from "../src/sidebar/zen";

const sample = JSON.stringify({
	generatedAt: 1,
	source: "opencode.db",
	periodStart: 1788220800000,
	totals: {
		fiveHour: { requests: 1, cost: 0.5, tokens: 10 },
		weekly: { requests: 3, cost: 1.5, tokens: 30 },
		month: { requests: 58, cost: 17, tokens: 340 },
	},
	models: [
		{
			id: "z-ai/glm-5.3-flash",
			provider: "opencode-go",
			limit: 60,
			fiveHour: { requests: 1, cost: 0.5, tokens: 10 },
			weekly: { requests: 2, cost: 1, tokens: 20 },
			month: { requests: 40, cost: 12, tokens: 300 },
		},
	],
});

/** mpc's oc side for the same model: rates, allowance and benchmarks. */
const meta: ModelMeta = {
	key: "glm53flash",
	name: "GLM 5.3 Flash",
	oc: {
		provider: "oc-go",
		plan: "Go",
		allowance: 60,
		rates: { input: 0.1, output: 0.2, cacheRead: 0.002 },
		ability: 48,
		tps: 120,
	},
};

describe("parseZenJson", () => {
	test("reads the period totals and the per-model windows", () => {
		const usage = parseZenJson(sample);
		expect(usage.totals.month).toEqual({
			requests: 58,
			cost: 17,
			tokens: 340,
		});
		expect(usage.models.get("glm53flash")).toEqual({
			id: "z-ai/glm-5.3-flash",
			provider: "opencode-go",
			limit: 60,
			fiveHour: { requests: 1, cost: 0.5, tokens: 10 },
			weekly: { requests: 2, cost: 1, tokens: 20 },
			month: { requests: 40, cost: 12, tokens: 300 },
		});
		expect(usage.source).toBe("opencode.db");
	});

	test("malformed input reads as no usage instead of throwing", () => {
		expect(parseZenJson("{not json").models.size).toBe(0);
		expect(parseZenJson("{}").totals.month.cost).toBe(0);
	});
});

describe("zenRows", () => {
	test("windows are the model's share of its own allowance", () => {
		const rows = zenRows(parseZenJson(sample), meta, {
			requests: 5,
			cost: 0.25,
		});
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("Plan")).toEqual(["Plan", "Go · limits per model", "base"]);
		// 5h = 20% of $60 = $12; 50% of the odd half-cent is traced back exactly.
		expect(find("5-hour")).toEqual(["5-hour", "$0.50/$12 (4.2%)", "ok"]);
		expect(find("Weekly")).toEqual(["Weekly", "$1/$30 (3.3%)", "ok"]);
		expect(find("Month")).toEqual(["Month", "$12/$60 (20.0%)", "ok"]);
		expect(find("Period")).toEqual(["Period", "58 requests · $17", "base"]);
		expect(find("Model")).toEqual(["Model", "GLM 5.3 Flash", "strong", true]);
		expect(find("Session")).toEqual(["Session", "5 req · $0.25", "base"]);
		expect(find("Allowance")).toEqual(["Allowance", "$60/mo", "base"]);
		expect(find("Rates")).toEqual(["Rates", "$0.1/$0.2 in/out", "base"]);
		expect(find("Intelligence")).toEqual(["Intelligence", "48", "base"]);
		expect(find("Tok/s")).toEqual(["Tok/s", "120", "base"]);
		// A rule separates the account block from the model block, like the CC panel.
		expect(
			rows.some((row) => row[2] === "muted" && row[0].startsWith("─")),
		).toBe(true);
	});

	test("without an allowance the windows are spend only (Zen is pay-as-you-go)", () => {
		// Zen reports no per-model limit, and mpc's oc side gives no allowance
		// for it either, so there is no cap to divide by.
		const zen = JSON.stringify({
			totals: {
				fiveHour: { requests: 1, cost: 0.5 },
				weekly: { requests: 2, cost: 1 },
				month: { requests: 58, cost: 17 },
			},
			models: [
				{
					id: "z-ai/glm-5.3-flash",
					provider: "opencode",
					limit: null,
					fiveHour: { requests: 1, cost: 0.5 },
					weekly: { requests: 2, cost: 1 },
					month: { requests: 40, cost: 12 },
				},
			],
		});
		const rows = zenRows(parseZenJson(zen), {
			key: "glm53flash",
			name: "GLM 5.3 Flash",
			oc: { plan: "Zen" },
		});
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("Plan")).toEqual(["Plan", "Zen · limits per model", "base"]);
		expect(find("5-hour")).toEqual(["5-hour", "$0.50 · 1 req", "base"]);
		expect(find("Allowance")).toBeUndefined();
		expect(find("Rates")).toBeUndefined();
	});

	test("no snapshot yields no rows at all", () => {
		expect(zenRows(undefined, meta)).toEqual([]);
	});

	test("without a catalog the model block keeps the name and session", () => {
		// mpc's catalog needs the network; the name and the local Session figure
		// must survive so the model part does not vanish across an outage.
		const rows = zenRows(
			parseZenJson(sample),
			undefined,
			{ requests: 5, cost: 0.25 },
			"glm-5.3-flash",
		);
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("Period")).toBeDefined();
		expect(find("Model")).toEqual(["Model", "glm-5.3-flash", "strong", true]);
		expect(find("Session")).toEqual(["Session", "5 req · $0.25", "base"]);
		expect(find("Allowance")).toBeUndefined();
		expect(find("Rates")).toBeUndefined();
	});
});
