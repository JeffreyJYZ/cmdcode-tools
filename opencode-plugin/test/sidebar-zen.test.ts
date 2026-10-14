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
		const rows = zenRows(
			parseZenJson(sample),
			meta,
			{ requests: 3, cost: 0.1 },
			{ requests: 5, cost: 0.25 },
		);
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("Plan")).toEqual(["Plan", "Go · limits per model", "base"]);
		// 5h = 20% of $60 = $12; 50% of the odd half-cent is traced back exactly.
		expect(find("5-hour")).toEqual(["5-hour", "$0.50/$12 (4.2%)", "ok"]);
		expect(find("Weekly")).toEqual(["Weekly", "$1/$30 (3.3%)", "ok"]);
		expect(find("Monthly")).toEqual(["Monthly", "$12/$60 (20.0%)", "ok"]);
		expect(find("Period")).toEqual(["Period", "58 requests · $17", "base"]);
		expect(find("Model")).toEqual([
			"Model",
			"GLM 5.3 Flash",
			"strong",
			true,
		]);
		// The store-backed rows sit where the CommandCode panel puts them: this
		// model's requests, then this conversation's totals.
		expect(find("Usage (this model)")).toEqual([
			"Usage (this model)",
			"3 req",
			"base",
		]);
		expect(rows.find((row) => row[1].includes("of session"))).toEqual([
			"",
			"$0.10 · 40% of session",
			"muted",
		]);
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

	test("a window at or over its cap is flagged, like CommandCode", () => {
		// Go has no `exceeded` flag, so the over-cap state is derived: a window at
		// its cap reads LIMIT EXCEEDED in the crit tone, where it used to read a
		// benign 100.0%.
		const over = JSON.stringify({
			totals: {
				fiveHour: { requests: 9, cost: 12 },
				weekly: { requests: 9, cost: 12 },
				month: { requests: 40, cost: 18 },
			},
			models: [
				{
					id: "z-ai/glm-5.3-flash",
					provider: "opencode-go",
					limit: 60,
					fiveHour: { requests: 9, cost: 12 },
					weekly: { requests: 9, cost: 12 },
					month: { requests: 40, cost: 18 },
				},
			],
		});
		const rows = zenRows(parseZenJson(over), meta);
		const five = rows.findIndex((row) => row[0] === "5-hour");
		// 20% of $60 = $12; $12 spent has reached it.
		expect(rows[five]).toEqual(["5-hour", "$12/$12 (100.0%)", "crit"]);
		expect(rows[five + 1]?.[1]).toBe("LIMIT EXCEEDED");
		expect(rows[five + 2]?.[1]).toBe("9 req");
	});

	test("Monthly gets its elapsed share and reset from the period bounds", () => {
		// ocuse publishes `periodEndAt` (epoch ms); with the start that gives the
		// period its length, so the Monthly row gets the same continuation the
		// CommandCode panel shows. Built relative to now so the countdown is real.
		const endAt = Date.now() + (3 * 60 + 50) * 60_000;
		const startAt = endAt - 31 * 24 * 3_600_000;
		const bounded = JSON.stringify({
			periodStart: startAt,
			periodEndAt: endAt,
			totals: {
				fiveHour: { requests: 1, cost: 0.5 },
				weekly: { requests: 3, cost: 1.5 },
				month: { requests: 58, cost: 12 },
			},
			models: [
				{
					id: "z-ai/glm-5.3-flash",
					provider: "opencode-go",
					limit: 60,
					fiveHour: { requests: 1, cost: 0.5 },
					weekly: { requests: 3, cost: 1.5 },
					month: { requests: 58, cost: 12 },
				},
			],
		});
		const rows = zenRows(parseZenJson(bounded), meta);
		const monthly = rows.findIndex((row) => row[0] === "Monthly");
		expect(rows[monthly]).toEqual(["Monthly", "$12/$60 (20.0%)", "ok"]);
		expect(rows[monthly + 1]?.[1]).toBe("99.5% elapsed · resets 3h 50m");
		expect(rows[monthly + 2]?.[1]).toBe("58 req");
	});

	test("Monthly degrades to spend alone without the period bounds", () => {
		// The sample carries no `periodEndAt`: an older ocuse has no reset epoch,
		// so there is no resets countdown and no elapsed share to show.
		const rows = zenRows(parseZenJson(sample), meta);
		const monthly = rows.findIndex((row) => row[0] === "Monthly");
		expect(rows[monthly]).toEqual(["Monthly", "$12/$60 (20.0%)", "ok"]);
		// The request count survives; the elapsed/resets continuation does not.
		expect(rows[monthly + 1]?.[1]).toBe("40 req");
		expect(rows.some((row) => (row[1] ?? "").includes("elapsed"))).toBe(
			false,
		);
	});

	test("the rolling 5-hour/Weekly windows carry no reset countdown", () => {
		// Deliberate: Go has no usage API, so a rolling window has no real reset
		// epoch — ocuse would have to invent "now + window", worse than nothing.
		const rows = zenRows(parseZenJson(sample), meta);
		const five = rows.findIndex((row) => row[0] === "5-hour");
		expect(rows[five + 1]?.[1]).toBe("1 req");
		expect(rows[five + 1]?.[1]).not.toContain("resets");
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
		expect(find("Plan")).toEqual([
			"Plan",
			"Zen · limits per model",
			"base",
		]);
		expect(find("5-hour")).toEqual(["5-hour", "$0.50 · 1 req", "base"]);
		expect(find("Allowance")).toBeUndefined();
		expect(find("Rates")).toBeUndefined();
	});

	test("a per-model cap is not applied to account-wide totals", () => {
		// mpc knows the active model's allowance, but ocuse has no row for it, so
		// the windows fall back to account-wide totals. Dividing those by one
		// model's cap would report the whole account against a single allowance.
		const rows = zenRows(parseZenJson(sample), {
			key: "other",
			name: "Some Other Model",
			oc: {
				provider: "oc-go",
				plan: "Go",
				allowance: 60,
				rates: { input: 0.1, output: 0.2, cacheRead: 0.002 },
			},
		});
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("5-hour")).toEqual(["5-hour", "$0.50 · 1 req", "base"]);
		expect(find("Monthly")).toEqual(["Monthly", "$17 · 58 req", "base"]);
		// The allowance itself is still shown from mpc's catalog.
		expect(find("Allowance")).toEqual(["Allowance", "$60/mo", "base"]);
	});

	test("a free model reads `∞`, not `$0/mo`", () => {
		// OpenCode Go's free models publish an Unlimited limit: mpc carries
		// allowance 0 with `free: true` and all-zero rates, which the panel used
		// to print as `Allowance $0/mo`.
		const rows = zenRows(parseZenJson(sample), {
			key: "step5preview",
			name: "Step 5 Preview",
			oc: {
				provider: "oc-go",
				plan: "Go",
				allowance: 0,
				free: true,
				rates: { input: 0, output: 0, cacheRead: 0 },
				ability: 44,
			},
		});
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("Allowance")).toEqual(["Allowance", "∞", "base"]);
		// No cap to divide: the windows degrade to spend only, like Zen.
		expect(find("5-hour")).toEqual(["5-hour", "$0.50 · 1 req", "base"]);
	});

	test("a zero allowance alone reads `∞` too", () => {
		const rows = zenRows(parseZenJson(sample), {
			key: "step5preview",
			name: "Step 5 Preview",
			oc: { plan: "Go", allowance: 0 },
		});
		expect(rows.find((row) => row[0] === "Allowance")).toEqual([
			"Allowance",
			"∞",
			"base",
		]);
	});

	test("the Plan row names the selected plan", () => {
		const rows = zenRows(parseZenJson(sample), {
			key: "glm53flash",
			name: "GLM 5.3 Flash",
			oc: {
				provider: "oc-go",
				plan: "Go Plus",
				allowance: 120,
				rates: { input: 0.1, output: 0.2, cacheRead: 0.002 },
			},
		});
		expect(rows.find((row) => row[0] === "Plan")?.[1]).toBe(
			"Go Plus · limits per model",
		);
		// The allowance follows the plan's limit.
		expect(rows.find((row) => row[0] === "Allowance")).toEqual([
			"Allowance",
			"$120/mo",
			"base",
		]);
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
			undefined,
			{ requests: 5, cost: 0.25 },
			"glm-5.3-flash",
		);
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("Period")).toBeDefined();
		expect(find("Model")).toEqual([
			"Model",
			"glm-5.3-flash",
			"strong",
			true,
		]);
		expect(find("Session")).toEqual(["Session", "5 req · $0.25", "base"]);
		// No model figure scanned, no `Usage (this model)` row.
		expect(find("Usage (this model)")).toBeUndefined();
		expect(find("Allowance")).toBeUndefined();
		expect(find("Rates")).toBeUndefined();
	});
});
