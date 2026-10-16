import { describe, expect, test } from "bun:test";
import { FIVE_HOUR_SECS, WEEKLY_SECS } from "../src/constants/sidebar";
import { type ModelMeta, usageRows } from "../src/sidebar/rows";
import { parseZenJson, rollingReset, zenRows } from "../src/sidebar/zen";

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

	test("caps and the allowance survive a missing catalog", () => {
		// ocuse keys its per-model rows by model id and ships the limit, so the
		// session's own id resolves both without mpc — the catalog supplies the
		// display name and the benchmarks, not the allowance. This is the state
		// the panel was in with a stale mpc: windows with no caps and no
		// Allowance row.
		const rows = zenRows(
			parseZenJson(sample),
			undefined,
			undefined,
			undefined,
			"glm-5.3-flash",
		);
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("5-hour")).toEqual(["5-hour", "$0.50/$12 (4.2%)", "ok"]);
		expect(find("Weekly")).toEqual(["Weekly", "$1/$30 (3.3%)", "ok"]);
		expect(find("Monthly")).toEqual(["Monthly", "$12/$60 (20.0%)", "ok"]);
		expect(find("Allowance")).toEqual(["Allowance", "$60/mo", "base"]);
		expect(find("Model")?.[1]).toBe("glm-5.3-flash");
		// mpc-only rows are the ones that drop out.
		expect(find("Rates")).toBeUndefined();
		expect(find("Intelligence")).toBeUndefined();
		expect(find("Tok/s")).toBeUndefined();
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

	test("without a window start the rolling windows stay spend only", () => {
		// The derived reset needs the oldest in-window request from the store;
		// with none (an empty window, or no read) there is nothing to count down,
		// so the request count stands alone, as before.
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
		// The allowance comes from ocuse, not mpc, so it survives the missing
		// catalog (0.5.2); only the mpc-only rows drop.
		expect(find("Allowance")).toEqual(["Allowance", "$60/mo", "base"]);
		expect(find("Rates")).toBeUndefined();
		expect(find("Intelligence")).toBeUndefined();
		expect(find("Tok/s")).toBeUndefined();
	});
});

describe("rolling window ageing-out (derived reset)", () => {
	// A rolling window's start is the oldest request still inside it, read from
	// opencode's own store by `useRows` and passed to `zenRows`; the reset is
	// that request's ageing-out, `start + window`. Epoch ms.
	const age = (secs: number) => Date.now() - secs * 1000;

	test("5-hour and Weekly show the elapsed share and the derived reset", () => {
		const rows = zenRows(
			parseZenJson(sample),
			meta,
			undefined,
			undefined,
			undefined,
			{
				fiveHour: age(FIVE_HOUR_SECS / 5), // an hour into 5h
				weekly: age(WEEKLY_SECS / 7), // a day into the week
			},
		);
		const five = rows.findIndex((row) => row[0] === "5-hour");
		expect(rows[five]).toEqual(["5-hour", "$0.50/$12 (4.2%)", "ok"]);
		expect(rows[five + 1]).toEqual([
			"",
			"20.0% elapsed · resets 4h",
			"muted",
		]);
		// The request count rides on after the continuation, as before.
		expect(rows[five + 2]?.[1]).toBe("1 req");
		const weekly = rows.findIndex((row) => row[0] === "Weekly");
		expect(rows[weekly + 1]).toEqual([
			"",
			"14.3% elapsed · resets 6d",
			"muted",
		]);
	});

	test("the reset is the oldest request plus the window", () => {
		const oldest = age(4 * 3600);
		// A derived-reset test on the pure helper, independent of rendering.
		expect(rollingReset(oldest, FIVE_HOUR_SECS)).toBe(
			oldest + FIVE_HOUR_SECS * 1000,
		);
		expect(rollingReset(undefined, FIVE_HOUR_SECS)).toBeUndefined();
		// Rendered: a request four hours old leaves the 5-hour window in an hour.
		const rows = zenRows(
			parseZenJson(sample),
			meta,
			undefined,
			undefined,
			undefined,
			{ fiveHour: oldest },
		);
		const five = rows.findIndex((row) => row[0] === "5-hour");
		expect(rows[five + 1]?.[1]).toBe("80.0% elapsed · resets 1h");
	});

	test("an empty rolling window keeps the request count alone", () => {
		const rows = zenRows(
			parseZenJson(sample),
			meta,
			undefined,
			undefined,
			undefined,
			{},
		);
		const five = rows.findIndex((row) => row[0] === "5-hour");
		expect(rows[five + 1]?.[1]).toBe("1 req");
		// No continuation row between the count and the next window.
		expect(rows[five + 2]?.[0]).toBe("Weekly");
		expect(rows.some((row) => (row[1] ?? "").includes("resets"))).toBe(
			false,
		);
	});

	test("the continuation matches the CommandCode row byte for byte", () => {
		// The whole point: the Go/Zen 5-hour continuation has the same shape and
		// tone as the CommandCode one, because both go through `windowRows`.
		const start = age(3600);
		const resetAt = rollingReset(start, FIVE_HOUR_SECS);
		const cc = usageRows(
			{
				plan: "GOAT",
				fiveHour: { cap: 12, used: 0.5, resetAt, exceeded: false },
			},
			Date.now(),
		);
		const ccFive = cc.findIndex((row) => row[0] === "5-hour");
		const zen = zenRows(
			parseZenJson(sample),
			meta,
			undefined,
			undefined,
			undefined,
			{ fiveHour: start },
		);
		const zenFive = zen.findIndex((row) => row[0] === "5-hour");
		expect(cc.slice(ccFive, ccFive + 2)).toEqual(
			zen.slice(zenFive, zenFive + 2),
		);
	});
});

describe("the account's own meters", () => {
	// What ocuse reports once it reached OpenCode Go's usage endpoint: the
	// console's three shares, not this machine's rolling windows. Built relative
	// to now so the countdowns and the elapsed shares are real.
	const withAccount = () => {
		const now = Date.now();
		return JSON.stringify({
			periodStart: now - 3 * 24 * 3_600_000,
			periodEndAt: now + 27 * 24 * 3_600_000,
			account: {
				rolling: {
					status: "ok",
					percent: 5,
					resetsAt: now + 4 * 3_600_000,
				},
				weekly: {
					status: "ok",
					percent: 59,
					resetsAt: now + 2 * 24 * 3_600_000,
				},
				monthly: {
					status: "ok",
					percent: 29,
					resetsAt: now + 27 * 24 * 3_600_000,
				},
			},
			totals: {
				fiveHour: { requests: 1, cost: 0.5 },
				weekly: { requests: 3, cost: 1.5 },
				month: { requests: 58, cost: 17 },
			},
			models: [
				{
					id: "z-ai/glm-5.3-flash",
					provider: "opencode-go",
					limit: 60,
					fiveHour: { requests: 1, cost: 0.5 },
					weekly: { requests: 3, cost: 1.5 },
					month: { requests: 58, cost: 17 },
				},
			],
		});
	};

	test("parseZenJson reads the meters, and leaves them out when absent", () => {
		const usage = parseZenJson(withAccount());
		expect(usage.account?.rolling).toEqual({
			status: "ok",
			percent: 5,
			resetsAt: expect.any(Number),
		});
		expect(usage.account?.weekly.percent).toBe(59);
		expect(usage.account?.monthly.percent).toBe(29);
		// An older ocuse (or one with no key) publishes no `account` block.
		expect(parseZenJson(sample).account).toBeUndefined();
	});

	test("the window rows pair the server's share with this store's money", () => {
		const rows = zenRows(parseZenJson(withAccount()), meta);
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(find("5-hour")?.[1]).toBe("$0.50/$12 (5.0% of limit)");
		expect(find("Weekly")?.[1]).toBe("$1.50/$30 (59.0% of limit)");
		expect(find("Monthly")?.[1]).toBe("$17/$60 (29.0% of limit)");
		// The reset countdown rides on the continuation, as on the CC side.
		expect(find("5-hour")?.[2]).toBe("ok");
		const five = rows.findIndex((row) => row[0] === "5-hour");
		expect(rows[five + 1]?.[1]).toContain("resets ");
		// The money is this store's own: it need not divide to the server's
		// share (the server meters higher), so both figures stay on the row.
		expect(find("5-hour")?.[1]).toContain("of limit");
	});

	test("a meter at its limit is flagged like an over-cap window", () => {
		const body = JSON.parse(withAccount()) as Record<string, unknown>;
		(body.account as Record<string, unknown>).rolling = {
			status: "rate_limited",
			percent: 100,
			resetsAt: Date.now() + 3_600_000,
		};
		const rows = zenRows(parseZenJson(JSON.stringify(body)), meta);
		const five = rows.findIndex((row) => row[0] === "5-hour");
		expect(rows[five]).toEqual([
			"5-hour",
			"$0.50/$12 (100.0% of limit)",
			"crit",
		]);
		expect(rows[five + 1]?.[1]).toContain("LIMIT EXCEEDED");
	});

	test("without meters the per-model windows still render", () => {
		// The fallback is what an older ocuse, a missing key or `--no-api` gives.
		const rows = zenRows(parseZenJson(sample), meta);
		expect(rows.find((row) => row[0] === "5-hour")?.[1]).toBe(
			"$0.50/$12 (4.2%)",
		);
	});
});
