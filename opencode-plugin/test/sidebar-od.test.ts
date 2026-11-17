import { describe, expect, test } from "bun:test";
import { oduseCandidates } from "../src/cli";
import { odArgs } from "../src/sidebar/data";
import { parseOdJson } from "../src/sidebar/od";
import { odSnapshot } from "./od-fixture";

describe("parseOdJson", () => {
	test("reads the caps, the period, the wallet and the per-model rows", () => {
		const usage = parseOdJson(odSnapshot());
		expect(usage.plan).toBe("go");
		expect(usage.caps).toEqual({
			monthlyUsd: 220,
			weeklyUsd: 55,
			fiveHourUsd: 18,
			planModelCreditsUsd: 0,
		});
		expect(usage.periodEndAt).toBeGreaterThan(usage.periodStart ?? 0);
		expect(usage.summary.credits).toBe(98.4);
		expect(usage.totals.fiveHour.requests).toBe(12);
		expect(usage.wallet?.balanceUsd).toBe(18.4);
		expect(usage.models.get("deepseek-v4.1-flash")?.month.credits).toBe(88);
	});

	test("a plan with no 5-hour cap keeps it absent, never zero", () => {
		// `caps.fiveHourUsd` is literally null for plus/pro/max: those plans do not
		// throttle on a 5-hour basis, so a 0 would read as an exhausted cap.
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.plan = "pro";
		body.caps = { ...(body.caps as object), fiveHourUsd: null };
		expect(parseOdJson(JSON.stringify(body)).caps.fiveHourUsd).toBeUndefined();
	});

	test("a closed wallet is null, with its reason, not a zero balance", () => {
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.wallet = null;
		body.walletError = "daemon not running";
		const usage = parseOdJson(JSON.stringify(body));
		expect(usage.wallet).toBeUndefined();
		expect(usage.walletError).toBe("daemon not running");
	});

	test("a period with no bounds leaves both ends absent", () => {
		// `--window all` reports `periodEndAt: null` and `periodStartAt: 0`: the
		// Monthly row must then degrade to spend alone instead of counting down
		// from a zero.
		const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
		body.periodStart = 0;
		body.periodStartAt = 0;
		body.periodEndAt = null;
		const usage = parseOdJson(JSON.stringify(body));
		expect(usage.periodEndAt).toBeUndefined();
	});

	test("malformed input reads as an empty `go` snapshot, never a fabricated one", () => {
		const usage = parseOdJson("{not json");
		expect(usage.plan).toBe("go");
		expect(usage.caps.monthlyUsd).toBeUndefined();
		expect(usage.summary.requests).toBe(0);
		expect(usage.wallet).toBeUndefined();
		expect(usage.models.size).toBe(0);
	});
});

describe("oduse invocation", () => {
	test("asks for the told plan, because nothing local records one", () => {
		expect(odArgs("go")).toEqual(["-1", "--json", "--plan", "go"]);
		expect(odArgs("max")).toEqual(["-1", "--json", "--plan", "max"]);
	});

	test("ODUSE_BIN wins over the fallback paths", () => {
		// The dev-build hook the sibling CLIs honour; without it a test or a lane
		// pointing at a working copy silently runs the installed binary.
		expect(oduseCandidates({ ODUSE_BIN: "/tmp/oduse-dev" })[0]).toBe("/tmp/oduse-dev");
		expect(oduseCandidates({})).toEqual([
			"oduse",
			"/opt/homebrew/bin/oduse",
			"/usr/local/bin/oduse",
		]);
	});
});
