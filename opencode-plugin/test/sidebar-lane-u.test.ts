import { describe, expect, test } from "bun:test";
import { ROW_WIDTH } from "../src/constants/sidebar";
import { parseArkJson, type ArkUsage, arkRows } from "../src/sidebar/ark";
import { parseOdJson } from "../src/sidebar/od";
import { odRows } from "../src/sidebar/od-rows";
import {
	type ModelMeta,
	modelRows,
	mutedWrap,
	parts,
	type SidebarRow,
	usageRows,
	valueWidth,
	rowWidth,
} from "../src/sidebar/rows";
import { parseZenJson, zenRows } from "../src/sidebar/zen";
import { odSnapshot } from "./od-fixture";
import { odSnapshotPerModel } from "./od-fixture-permodel";

const zero = { requests: 0, cost: 0, tokens: 0 };

/** `ocuse -1 --json` with the reported cap-change note, two models and no
 *  clock dependency beyond a relative now. */
function zenBody(): Record<string, unknown> {
	const now = Date.now();
	return {
		periodStart: now - 3 * 86_400_000,
		periodEndAt: now + 27 * 86_400_000,
		account: {
			rolling: { status: "ok", percent: 12, resetsAt: now + 4 * 3_600_000 },
			weekly: { status: "ok", percent: 40, resetsAt: now + 2 * 86_400_000 },
			monthly: {
				status: "ok",
				percent: 76,
				percentSource: "server",
				note: "the allowance changed during this period (DeepSeek V4.1 Flash); the server meters 76%, today's cap implies 69.9%",
				resetsAt: now + 27 * 86_400_000,
			},
		},
		capChanges: [] as Array<{ model: string; from: number; to: number; at: number }>,
		totals: { fiveHour: zero, weekly: zero, month: { requests: 58, cost: 69.98, tokens: 340 } },
		models: [
			{
				id: "deepseek-v4.1-flash",
				provider: "opencode-go",
				limit: 100,
				fiveHour: zero,
				weekly: zero,
				month: { requests: 58, cost: 69.98, tokens: 340 },
			},
			{
				id: "glm-5.3-flash",
				provider: "opencode-go",
				limit: 60,
				fiveHour: zero,
				weekly: zero,
				month: { requests: 4, cost: 1.5, tokens: 20 },
			},
		],
	};
}

const meta: ModelMeta = {
	key: "flash",
	name: "DeepSeek V4.1 Flash",
	oc: { plan: "Go", allowance: 100, rates: { input: 0.15, output: 0.6, cacheRead: 0.003 } },
};

const ccUsage = {
	plan: "GOAT",
	monthlyCap: 70,
	monthlyCredits: 14.62,
	fiveHour: { cap: 14, used: 0.55, resetAt: Date.now() + 4.8 * 3_600_000 },
	weekly: { cap: 35, used: 18.46, resetAt: Date.now() + 21.7 * 3_600_000 },
	requests: 7_300,
	cost: 55.29,
};

function arkUsage(profile: string): ArkUsage {
	return parseArkJson(
		JSON.stringify({
			plan: "medium",
			profile,
			summary: { afp: 4_300, requests: 231 },
			monthly: { afp: 4_300, requests: 231 },
			models: {},
		}),
	);
}

describe("lane U — identities and bounded prose", () => {
	test("an_identity_is_never_abbreviated_to_fit_a_value", () => {
		// OpenDesign: 31 columns fits the panel, but not beside a short money
		// value. The id goes on its own row whole; the money drops below it.
		const longId = "deepseek-v4.1-flash-eco-preview";
		const od = JSON.parse(odSnapshotPerModel()) as { models: Array<{ id: string }> };
		if (od.models[0]) od.models[0].id = longId;
		const odRowsForLong = odRows(parseOdJson(JSON.stringify(od)));
		expect(odRowsForLong.some((row) => row[0] === longId && row[1] === "")).toBe(true);
		expect(odRowsForLong.some((row) => row[1]?.trim() === "$88/$120")).toBe(true);
		expect(odRowsForLong.some((row) => (row[0] ?? "").includes("…"))).toBe(false);

		// ARK: the profile used to be clipped off the end of the Plan row.
		const profile = "agent-plan_cn-beijing_medium";
		const ark = arkRows(arkUsage(profile), "deepseek-v4.1-flash");
		expect(ark[0]).toEqual(["Plan", "medium · AFP plan", "base", true]);
		expect(ark[1]).toEqual(["", profile, "muted"]);
		expect(ark.some((row) => row[1]?.includes("…"))).toBe(false);
	});

	test("a_deal_badge_wraps_to_at_most_two_lines", () => {
		const badge = "Flash sale -40% · Ends September 27, 2026";
		const rows = modelRows({ key: "promo", name: "Promo Model", deal: { badge } });
		const at = rows.findIndex((row) => row[0] === "Deal");
		// First line on the row, second indented under the value column. Both
		// whole words; the row cannot grow with the upstream string.
		expect(rows[at]).toEqual(["Deal", "Flash sale -40% · Ends", "ok"]);
		expect(rows[at + 1]).toEqual(["", "    September 27, 2026", "muted"]);
		expect(rows[at + 2]).toBeUndefined();
		expect([rows[at]?.[1], rows[at + 1]?.[1]?.trim()].join(" ")).toBe(badge);

		// A third clause is dropped, never cut mid-word.
		const longer = modelRows({
			key: "promo",
			name: "Promo Model",
			deal: { badge: `${badge} · only while stocks last` },
		});
		const more = longer.findIndex((row) => row[0] === "Deal");
		expect(longer[more]).toEqual(["Deal", "Flash sale -40% · Ends", "ok"]);
		expect(longer[more + 1]).toEqual(["", "    September 27, 2026", "muted"]);
		expect(longer[more + 2]).toBeUndefined();
		expect(longer.some((row) => row[1]?.includes("stocks"))).toBe(false);
	});

	test("every_family_renders_within_the_panel_width", () => {
		const body = zenBody();
		body.capChanges = [
			{
				model: "deepseek-v4.1-flash",
				from: 123_456_789,
				to: 987_654_321,
				at: Date.UTC(2026, 10, 19),
			},
		];
		const longName: ModelMeta = {
			...meta,
			name: "Claude Sonnet 5 (Anthropic, extended thinking variant)",
			deal: { badge: "Flash sale -40% · Ends September 27, 2026" },
		};
		const cases: Array<[string, SidebarRow[]]> = [
			[
				"Command Code",
				[
					...usageRows({ ...ccUsage, plan: "GOAT-GOAT-GOAT-GOAT-GOAT-GOAT" }),
					...modelRows(longName),
				],
			],
			["Go/Zen", zenRows(parseZenJson(JSON.stringify(body)), longName)],
			["ARK", arkRows(arkUsage("agent-plan_cn-beijing_medium"), "deepseek-v4.1-flash")],
			[
				"OpenDesign",
				[
					...odRows(parseOdJson(odSnapshot())),
					...odRows(parseOdJson(odSnapshotPerModel())),
				],
			],
		];
		for (const [family, rows] of cases) {
			for (const row of rows) {
				expect(
					parts(row).join("").length,
					`${family}: ${row[0]}: ${row[1]}`,
				).toBeLessThanOrEqual(ROW_WIDTH);
				expect(rowWidth(row), `${family}: ${row[0]}: ${row[1]}`).toBeLessThanOrEqual(
					ROW_WIDTH,
				);
			}
		}
	});

	test("muted_wrap_matches_the_zen_layout", () => {
		const text = "limit $123456789→$987654321 on 2026-11-19";
		const direct: SidebarRow[] = [];
		mutedWrap(direct, text, valueWidth(""));
		const expected: SidebarRow[] = [
			["", "limit $123456789→$987654321 on", "muted"],
			["", "2026-11-19", "muted"],
		];
		expect(direct).toEqual(expected);
		// The helper now lives in rows.ts; zen.ts's cap change goes through it,
		// so the rendered continuation is byte-identical to a direct call.
		const body = zenBody();
		body.capChanges = [
			{
				model: "deepseek-v4.1-flash",
				from: 123_456_789,
				to: 987_654_321,
				at: Date.UTC(2026, 10, 19),
			},
		];
		const rows = zenRows(parseZenJson(JSON.stringify(body)), meta);
		const at = rows.findIndex((row) => (row[1] ?? "").startsWith("limit $123456789"));
		expect(rows.slice(at, at + 2)).toEqual(expected);
	});
});
