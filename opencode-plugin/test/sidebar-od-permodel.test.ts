import { describe, expect, test } from "bun:test";
import { capSetFor, capsAreHeadline, parseCaps } from "../src/sidebar/od-caps";
import { windowCaps } from "../src/sidebar/od-window-caps";
import { parseOdJson } from "../src/sidebar/od";
import { odRows } from "../src/sidebar/od-rows";
import { odSnapshot } from "./od-fixture";
import { odSnapshotMixed, odSnapshotPerModel } from "./od-fixture-permodel";

const rowsOf = (text: string) => odRows(parseOdJson(text));
const find = <T extends { 0: string }>(rows: T[], label: string) =>
	rows.find((row) => row[0] === label);

const GO_PER_MODEL = {
	caps: {
		"deepseek-v4.1-flash": { month: 120, week: 30, fiveHour: 10, label: "Flash caps" },
		"deepseek-v4.1-flash-eco": { month: 220, week: 55, fiveHour: 18, label: "Eco caps" },
	},
	defaultCaps: { month: 120, week: 30, fiveHour: 10, label: "Flash caps" },
};

describe("parseCaps", () => {
	test("the per-model shape wins over a legacy block, and both parse", () => {
		const caps = parseCaps({
			...GO_PER_MODEL,
			monthlyUsd: 220,
			weeklyUsd: 55,
			fiveHourUsd: 18,
		});
		expect(caps.byModel.get("deepseek-v4.1-flash")?.monthlyUsd).toBe(120);
		expect(caps.byModel.get("deepseek-v4.1-flash-eco")?.monthlyUsd).toBe(220);
		expect(caps.defaultCaps?.fiveHourUsd).toBe(10);
		expect(caps.legacy?.monthlyUsd).toBe(220);
		expect(capsAreHeadline(caps)).toBe(false);
	});

	test("the legacy block alone is the plan's headline allowance", () => {
		const caps = parseCaps({ monthlyUsd: 220, weeklyUsd: 55, fiveHourUsd: 18 });
		expect(caps.byModel.size).toBe(0);
		expect(caps.defaultCaps).toBeUndefined();
		expect(capsAreHeadline(caps)).toBe(true);
		// An older binary is still usable: the one set it knows answers every model.
		expect(capSetFor(caps, "deepseek-v4.1-flash")?.monthlyUsd).toBe(220);
	});

	test("a null 5-hour cap stays absent, never a zero", () => {
		const caps = parseCaps({ monthlyUsd: 310, weeklyUsd: 74, fiveHourUsd: null });
		expect(caps.legacy?.fiveHourUsd).toBeUndefined();
		expect(caps.legacy?.monthlyUsd).toBe(310);
	});

	test("malformed input yields no sets rather than a fabricated one", () => {
		const caps = parseCaps(null);
		expect(caps.legacy).toBeUndefined();
		expect(caps.byModel.size).toBe(0);
		expect(capsAreHeadline(caps)).toBe(false);
	});
});

describe("windowCaps", () => {
	test("one model picks its own allowance and names it", () => {
		const caps = parseCaps(GO_PER_MODEL);
		const chosen = windowCaps(caps, "month", [{ id: "deepseek-v4.1-flash", credits: 88 }]);
		expect(chosen?.set.monthlyUsd).toBe(120);
		expect(chosen?.label).toBe("Flash caps");
		expect(chosen?.mixed).toBe(false);
	});

	test("a mixed window takes the stricter set and names the looser one", () => {
		const caps = parseCaps(GO_PER_MODEL);
		const chosen = windowCaps(caps, "month", [
			{ id: "deepseek-v4.1-flash", credits: 88 },
			{ id: "deepseek-v4.1-flash-eco", credits: 10.4 },
		]);
		expect(chosen?.set.monthlyUsd).toBe(120);
		expect(chosen?.mixed).toBe(true);
		expect(chosen?.alternatives).toEqual(["Eco $220"]);
	});

	test("a model with no entry falls to defaultCaps, not to the headline", () => {
		const caps = parseCaps({
			caps: { "deepseek-v4.1-flash-eco": { month: 220, week: 55, fiveHour: 18 } },
			defaultCaps: { month: 120, week: 30, fiveHour: 10, label: "Flash caps" },
		});
		const chosen = windowCaps(caps, "month", [{ id: "glm-5.3-flash", credits: 10.4 }]);
		expect(chosen?.set.monthlyUsd).toBe(120);
		expect(chosen?.label).toBe("Flash caps");
	});

	test("a window no set publishes is absent, never zero", () => {
		const caps = parseCaps({ monthlyUsd: 310, weeklyUsd: 74, fiveHourUsd: null });
		expect(windowCaps(caps, "fiveHour", [])).toBeUndefined();
	});
});

describe("odRows with per-model caps", () => {
	test("Go's Flash row is divided by $120, not the Eco headline $220", () => {
		const rows = rowsOf(odSnapshotPerModel());
		const monthly = find(rows, "Monthly");
		expect(monthly?.[1]).toBe("$98.40/$120 (82.0%)");
		// The set that published the denominator is named on a continuation.
		const note = rows.find((row) => row[1].startsWith("of $120"));
		expect(note?.[1]).toBe("of $120 · Flash caps");
		// And the per-model table divides each model by its own allowance.
		const head = rows.findIndex((row) => row[1] === "by model · this period");
		expect(rows[head + 1]).toEqual(["deepseek-v4.1-flash", "$88/$120 (73.3%)", "base"]);
	});

	test("the caveats no longer claim the headline set is the meter", () => {
		const rows = rowsOf(odSnapshotPerModel());
		expect(rows.some((row) => row[1] === "caps: headline allowance only")).toBe(false);
		expect(rows.some((row) => row[1] === "no cap set published")).toBe(false);
	});

	test("a mixed window shows the stricter cap and names both sets", () => {
		const rows = rowsOf(odSnapshotMixed());
		// Flash ($120) is stricter than Eco ($220) over the month.
		expect(find(rows, "Monthly")?.[1]).toBe("$98.40/$120 (82.0%)");
		const note = rows.find((row) => row[1].startsWith("of $120"));
		expect(note?.[1]).toContain("Flash caps");
		expect(note?.[1]).toContain("Eco $220");
	});

	test("only the legacy block renders, marked as the plan's headline allowance", () => {
		// The previous binary's payload: one flat block, so every figure is divided
		// by Eco's $220 and the row must say the set is the headline, not this
		// model's meter.
		const rows = rowsOf(
			JSON.stringify({
				plan: "go",
				caps: { monthlyUsd: 220, weeklyUsd: 55, fiveHourUsd: 18 },
				periodStart: Date.now() - 10 * 86_400_000,
				periodStartAt: Date.now() - 10 * 86_400_000,
				periodEndAt: Date.now() + 20 * 86_400_000,
				summary: { requests: 1, tokensIn: 1, tokensOut: 1, costUsd: 1, credits: 1 },
				totals: {
					month: { requests: 1, tokensIn: 1, tokensOut: 1, costUsd: 1, credits: 1 },
					fiveHour: { requests: 1, tokensIn: 1, tokensOut: 1, costUsd: 1, credits: 1 },
					weekly: { requests: 1, tokensIn: 1, tokensOut: 1, costUsd: 1, credits: 1 },
				},
				models: [],
			}),
		);
		expect(find(rows, "Monthly")?.[1]).toBe("$1/$220 (0.5%)");
		expect(rows.some((row) => row[1] === "of $220 · headline allowance")).toBe(true);
	});
});

describe("oduse's shipped capOverrides + capPicks payload", () => {
	// The sibling lane publishes the plan's own set as `caps.monthlyUsd` etc plus
	// `defaultCapLabel`, a `capOverrides` list keyed by model id, and one chosen
	// set per window in `capPicks`. The panel must consume that shape as it is.
	const shipped = () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.caps = {
			monthlyUsd: 220,
			weeklyUsd: 55,
			fiveHourUsd: 18,
			planModelCreditsUsd: 0,
			defaultCapLabel: "Eco",
			capOverrides: [
				{
					id: "flash",
					label: "Flash",
					models: ["deepseek-v4.1-flash"],
					monthlyUsd: 120,
					weeklyUsd: 30,
					fiveHourUsd: 10,
				},
			],
		};
		body.capPicks = {
			monthly: { id: "flash", label: "Flash", planDefaultMonthlyUsd: 220 },
			weekly: { id: "flash", label: "Flash", planDefaultMonthlyUsd: 55 },
			fiveHour: { id: "flash", label: "Flash", planDefaultMonthlyUsd: 18 },
		};
		return JSON.stringify(body);
	};

	test("capOverrides resolves the Flash model's own allowance", () => {
		const usage = parseOdJson(shipped());
		expect(capsAreHeadline(usage.caps)).toBe(false);
		expect(usage.caps.byModel.get("deepseek-v4.1-flash")?.monthlyUsd).toBe(120);
		expect(usage.caps.legacy?.label).toBe("Eco");
		expect(usage.capPicks.get("month")?.label).toBe("Flash");
	});

	test("the CLI's own per-window pick wins, and names the plan's looser cap", () => {
		const rows = rowsOf(shipped());
		expect(find(rows, "Monthly")?.[1]).toBe("$98.40/$120 (82.0%)");
		const note = rows.find((row) => row[1].startsWith("of $120"));
		expect(note?.[1]).toContain("Flash");
		expect(note?.[1]).toContain("Eco $220");
	});
});
