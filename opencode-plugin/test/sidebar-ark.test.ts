import { describe, expect, test } from "bun:test";
import { ROW_WIDTH } from "../src/constants/sidebar";
import { type ArkUsage, arkRows, parseArkJson } from "../src/sidebar/ark";
import { rowWidth } from "../src/sidebar/rows";

/** A snapshot in `arkuse -1 --json`'s shape: meters answered, one model. */
const withAccount = () =>
	JSON.stringify({
		source: "opencode",
		scope: "local",
		plan: "medium",
		profile: "agent-plan_cn-beijing_medium",
		periodStart: 1792339200000,
		periodEndAt: 1795103999000,
		summary: {
			afp: 4_300,
			yuan: 8.6,
			requests: 231,
			tokensIn: 936_500,
			tokensOut: 118_500,
			cacheRead: 33_000_000,
		},
		fiveHour: { afp: 4_300, requests: 231 },
		weekly: { afp: 4_300, requests: 231 },
		monthly: { afp: 4_300, requests: 231 },
		account: {
			fiveHour: {
				used: 4_478,
				total: 10_000,
				percent: 44.8,
				status: "ok",
				resetAt: 1792427077000,
			},
			weekly: {
				used: 4_478,
				total: 35_000,
				percent: 12.8,
				status: "ok",
				resetAt: 1792944000000,
			},
			monthly: {
				used: 4_478,
				total: 100_000,
				percent: 4.5,
				status: "ok",
				resetAt: 1795103999000,
			},
		},
		models: {
			"deepseek-v4.1-flash": {
				coef: 1.25,
				fiveHour: { afp: 4_300, requests: 231 },
				weekly: { afp: 4_300, requests: 231 },
				month: { afp: 4_300, requests: 231 },
			},
		},
	});

describe("parseArkJson", () => {
	test("reads the meters, the period bounds and the model row", () => {
		const usage = parseArkJson(withAccount());
		expect(usage.plan).toBe("medium");
		expect(usage.periodEndAt).toBe(1795103999000);
		expect(usage.account?.fiveHour).toEqual({
			status: "ok",
			percent: 44.8,
			used: 4_478,
			total: 10_000,
			resetAt: 1792427077000,
		});
		expect(usage.models.get("deepseek-v4.1-flash")?.month.afp).toBe(4_300);
	});

	test("malformed input reads as an empty snapshot, never a fabricated plan", () => {
		const usage = parseArkJson("{not json");
		expect(usage.plan).toBe("medium");
		expect(usage.account).toBeUndefined();
		expect(usage.models.size).toBe(0);
	});
});

describe("arkRows", () => {
	test("uses the plan's own quota and puts this store's AFP beside it", () => {
		const rows = arkRows(
			parseArkJson(withAccount()),
			"deepseek-v4.1-flash",
		);
		const five = rows.find((row) => row[0] === "5-hour");
		expect(five?.[1]).toContain("/10K");
		expect(five?.[1]).toContain("44.8%");
		expect(rows.some((row) => row[1] === "4,300 AFP local · 231 req")).toBe(
			true,
		);
		// AFP, not dollars: no money symbol anywhere in the window block.
		expect(five?.[1]).not.toContain("$");
		const model = rows.find((row) => row[0] === "AFP (this model)");
		expect(model?.[1]).toContain("4,300 AFP");
	});

	test("without an account answer the rows are this store's AFP alone", () => {
		const body = JSON.parse(withAccount()) as Record<string, unknown>;
		delete body.account;
		body.accountError = "arkcli not found on PATH";
		const usage: ArkUsage = parseArkJson(JSON.stringify(body));
		const rows = arkRows(usage, undefined);
		expect(rows.some((row) => row[2] === "warn")).toBe(true);
		const five = rows.find((row) => row[0] === "5-hour");
		expect(five?.[1]).toBe("4,300 AFP · 231 req");
		expect(five?.[1]).not.toContain("/");
	});

	test("an unread model still gets a per-model row", () => {
		const rows = arkRows(parseArkJson(withAccount()), "glm-5.3");
		expect(rows.find((row) => row[0] === "AFP (this model)")?.[1]).toBe(
			"no usage in this period",
		);
	});

	test("every row fits the 42-column sidebar", () => {
		for (const rows of [
			arkRows(parseArkJson(withAccount()), "deepseek-v4.1-flash"),
			arkRows(
				parseArkJson(
					JSON.stringify({
						...JSON.parse(withAccount()),
						account: undefined,
						accountError: "arkcli not found on PATH",
					}),
				),
				"deepseek-v4.1-flash",
			),
		]) {
			for (const row of rows) {
				expect(rowWidth(row)).toBeLessThanOrEqual(ROW_WIDTH);
			}
		}
	});
});
