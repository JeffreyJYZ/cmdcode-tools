import { describe, expect, test } from "bun:test";
import { parseOdJson } from "../src/sidebar/od";
import { odRows } from "../src/sidebar/od-rows";
import { odSnapshot } from "./od-fixture";

const rowsOf = (body: unknown) => odRows(parseOdJson(JSON.stringify(body)));

describe("odRows", () => {
	test("the plan, both estimate caveats and the three published windows", () => {
		const rows = odRows(parseOdJson(odSnapshot()));
		const find = (label: string) => rows.find((row) => row[0] === label);
		expect(rows[0]).toEqual(["OpenDesign", "go plan · estimate", "base", true]);
		// The caveats sit directly under the headline: without them a reader takes
		// the credits for a meter and the 5-hour cut for the plan's own window.
		expect(rows[1]?.[1]).toBe("credits = list-price $ x multiplier");
		expect(rows[2]?.[1]).toBe("estimate · 5h/7d cut locally");
		expect(find("5-hour")).toEqual(["5-hour", "$4.20/$18 (23.3%)", "base"]);
		expect(find("Weekly")).toEqual(["Weekly", "$9.10/$55 (16.5%)", "base"]);
		expect(find("Monthly")).toEqual(["Monthly", "$98.40/$220 (44.7%)", "base"]);
		// The rolling cuts have no reset this machine can know; the request count
		// is their only continuation.
		expect(find("5-hour")?.[1]).not.toContain("resets");
	});

	test("Monthly carries the period's own pacing and reset", () => {
		// Built relative to now so the countdown is real. A monthly cap with the
		// period half gone and spend ahead of even burn gets the `cap in …` lead,
		// the same one the Command Code panel shows.
		const rows = odRows(parseOdJson(odSnapshot()));
		const monthly = rows.findIndex((row) => row[0] === "Monthly");
		expect(rows[monthly + 1]?.[1]).toMatch(/^cap in .+ · resets (19d 23h|20d)$/);
		expect(rows[monthly + 2]?.[1]).toBe("231 req");
	});

	test("a period about to end shows the elapsed share instead", () => {
		// With the reset minutes away there is no honest projection, so the
		// continuation falls back to the elapsed share — the shared rule, not a
		// second one for this section.
		const endAt = Date.now() + (3 * 60 + 50) * 60_000;
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.periodStart = endAt - 31 * 24 * 3_600_000;
		body.periodStartAt = body.periodStart;
		body.periodEndAt = endAt;
		const rows = rowsOf(body);
		const monthly = rows.findIndex((row) => row[0] === "Monthly");
		expect(rows[monthly + 1]?.[1]).toBe("99.5% elapsed · resets 3h 50m");
	});

	test("an inferred period start is called out beside the other caveats", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.periodInferred = true;
		const rows = rowsOf(body);
		expect(rows[3]?.[1]).toBe("month start inferred");
		// Not claimed when the CLI pinned the start.
		expect(
			rowsOf(JSON.parse(odSnapshot())).some((row) => row[1] === "month start inferred"),
		).toBe(false);
	});

	test("a plan with no 5-hour cap has no 5-hour row at all", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.plan = "plus";
		body.caps = { ...(body.caps as object), fiveHourUsd: null };
		const rows = rowsOf(body);
		expect(rows.find((row) => row[0] === "5-hour")).toBeUndefined();
		// The other two caps are published on every plan.
		expect(rows.find((row) => row[0] === "Weekly")).toBeDefined();
		expect(rows.find((row) => row[0] === "Monthly")).toBeDefined();
		expect(rows[0]?.[1]).toBe("plus plan · estimate");
		// The caveat names only the cut this plan has: there is no 5-hour window
		// to call local.
		expect(rows[2]?.[1]).toBe("estimate · 7d cut locally");
	});

	test("the wallet is a balance on its own row, and a closed app is one dim line", () => {
		const open = rowsOf(JSON.parse(odSnapshot()));
		expect(open.find((row) => row[0] === "Wallet")).toEqual([
			"Wallet",
			"$18.40 balance",
			"base",
		]);
		// A cached answer from the daemon says so.
		const staleBody = JSON.parse(odSnapshot()) as Record<string, unknown>;
		(staleBody.wallet as Record<string, unknown>).stale = true;
		expect(rowsOf(staleBody).find((row) => row[0] === "Wallet")?.[1]).toBe(
			"$18.40 balance · cached",
		);
		// Closed app: a reason and no figure — never `$0`, which would read as an
		// empty wallet rather than "no meter".
		const closed = JSON.parse(odSnapshot()) as Record<string, unknown>;
		closed.wallet = null;
		closed.walletError = "daemon not running";
		const wallet = rowsOf(closed).find((row) => row[0] === "Wallet");
		expect(wallet).toEqual(["Wallet", "no meter · daemon not running", "muted"]);
		expect(wallet?.[1]).not.toContain("$0");
	});

	test("a long reason keeps the verdict, never a reason cut mid-word", () => {
		// The CLI's real reason names the endpoint: "daemon not running at
		// http://127.0.0.1:7456 (Connection refused (os error 61))".
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.wallet = null;
		body.walletError =
			"daemon not running at http://127.0.0.1:7456 (Connection refused (os error 61))";
		const wallet = rowsOf(body).find((row) => row[0] === "Wallet");
		expect(wallet).toEqual(["Wallet", "no meter", "muted"]);
	});

	test("a wallet that answered without a number is still no meter, never $0", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.wallet = { balanceUsd: "eighteen", stale: false };
		expect(rowsOf(body).find((row) => row[0] === "Wallet")).toEqual([
			"Wallet",
			"no meter · unreadable balance",
			"muted",
		]);
	});

	test("a zero balance is drawn as $0, because the daemon said zero", () => {
		// The opposite case: a real `0` is a figure, not a missing meter. Only a
		// null wallet (or an unreadable one) reads as "no meter".
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		(body.wallet as Record<string, unknown>).balanceUsd = 0;
		expect(rowsOf(body).find((row) => row[0] === "Wallet")).toEqual([
			"Wallet",
			"$0 balance",
			"base",
		]);
	});

	test("an empty period renders the caps and says so instead of a table", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		const zero = { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, credits: 0 };
		body.totals = { month: zero, fiveHour: zero, weekly: zero };
		body.summary = zero;
		body.models = [];
		const rows = rowsOf(body);
		expect(rows.find((row) => row[0] === "Period")?.[1]).toBe("0 requests · $0 credits");
		expect(rows.some((row) => row[1] === "no completed turns in this period")).toBe(true);
		expect(rows.some((row) => row[1] === "by model · this period")).toBe(false);
		// The block still names the plan and every cap it publishes, so an empty
		// store is not mistaken for a broken section.
		expect(rows.filter((row) => row[0] === "").length).toBeGreaterThan(2);
	});

	test("a window at its cap is flagged like every other section", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		(body.totals as Record<string, unknown>).weekly = {
			requests: 90,
			credits: 60,
			costUsd: 120,
			tokensIn: 1,
			tokensOut: 2,
		};
		const rows = rowsOf(body);
		const weekly = rows.findIndex((row) => row[0] === "Weekly");
		expect(rows[weekly]).toEqual(["Weekly", "$60/$55 (109.1%)", "crit"]);
		expect(rows[weekly + 1]?.[1]).toBe("LIMIT EXCEEDED");
	});

	test("per-model credits are listed biggest first, against the monthly cap", () => {
		const rows = rowsOf(JSON.parse(odSnapshot()));
		const head = rows.findIndex((row) => row[1] === "by model · this period");
		expect(head).toBeGreaterThan(-1);
		expect(rows[head + 1]).toEqual(["deepseek-v4.1-flash", "$88/$220 (40.0%)", "base"]);
		expect(rows[head + 2]?.[1]).toBe("$10.40/$220 (4.7%)");
	});

	test("a published plan-model allowance rides as a row with no meter", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.caps = { ...(body.caps as object), planModelCreditsUsd: 20 };
		expect(rowsOf(body).some((row) => row[1] === "plan-model credits $20 · no meter")).toBe(
			true,
		);
	});

	test("an unpriced model says so instead of printing $0", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		(body.models as Array<Record<string, unknown>>)[1] = {
			id: "glm-5.3-flash",
			multiplier: 1,
			priced: false,
			month: { requests: 31, credits: 0, costUsd: 0, tokensIn: 1, tokensOut: 2 },
			fiveHour: { requests: 2, credits: 0, costUsd: 0, tokensIn: 1, tokensOut: 2 },
			weekly: { requests: 8, credits: 0, costUsd: 0, tokensIn: 1, tokensOut: 2 },
		};
		expect(
			rowsOf(body).some(
				(row) => row[0] === "glm-5.3-flash" && row[1] === "31 req · unpriced",
			),
		).toBe(true);
	});

	test("no snapshot yields no rows, so the section never prints a stray rule", () => {
		expect(odRows(undefined)).toEqual([]);
	});
});
