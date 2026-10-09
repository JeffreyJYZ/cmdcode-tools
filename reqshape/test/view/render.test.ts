import { describe, expect, test } from "bun:test";
import type { DropCount } from "#~/types.ts";
import { setColorMode } from "#~/view/format.ts";
import { renderText } from "#~/view/render.ts";
import { entry, projection, report } from "./fixtures.ts";

setColorMode(false);

describe("renderText", () => {
	test("lays out the measurement, then what the allowance buys", () => {
		const text = renderText(report());
		expect(text).toContain("every req weighted equally");
		expect(text).toContain("1,084 asks");
		expect(text).toContain("2026-07-10 → 2026-09-29");
		expect(text).toContain("trivial prompt 137");
		expect(text).toContain("cache read 248.0K");
		expect(text).toContain(
			"one vote per conversation instead: cache read 64.0K",
		);
		expect(text).toContain("pos 101+");
		expect(text).toContain("deepseek-v4.1-flash 2.7K");
		expect(text).toContain("MODEL");
		expect(text).toContain("CC GOAT");
		expect(text).toContain("$0.00231");
		expect(text).toContain("30.0K");
	});

	test("--weight session says which mean the projection used", () => {
		const text = renderText(report({ weight: "session" }));
		expect(text).toContain("each conversation one vote");
		expect(text).toContain("which is what the projection prices");
	});

	test("only a missing cache-read rate is flagged, since that is the one that bites", () => {
		const flagged = renderText(
			report({ projections: [projection({ cacheAtInput: true })] }),
		);
		expect(flagged).toContain("billed at the input rate");
		// A missing write rate is immaterial at 8 tokens a request: no flag.
		const plain = renderText(
			report({ projections: [projection({ writeAtInput: true })] }),
		);
		expect(plain).not.toContain("billed at the input rate");
	});

	test("--explain lists every reason, the default trims to six", () => {
		const drops: DropCount[] = [
			{ reason: "trivial prompt", asks: 137, reqs: 140 },
			{ reason: "synthetic prompt", asks: 258, reqs: 900 },
			{ reason: "system prompt", asks: 129, reqs: 0 },
			{ reason: "empty prompt", asks: 14, reqs: 14 },
			{ reason: "compaction prompt", asks: 9, reqs: 0 },
			{ reason: "shell prompt", asks: 7, reqs: 0 },
			{ reason: "orphan prompt", asks: 3, reqs: 3 },
		];
		expect(renderText(report({ drops }))).not.toContain("orphan prompt");
		expect(renderText(report({ drops, explain: true }))).toContain(
			"orphan prompt 3",
		);
	});

	test("free and capped figures render without inventing numbers", () => {
		const text = renderText(
			report({
				projections: [
					projection({
						costPerReq: 0,
						requestsPerMonth: Number.POSITIVE_INFINITY,
						requestsPerFiveHour: Number.POSITIVE_INFINITY,
						requestsPerWeek: Number.POSITIVE_INFINITY,
					}),
					projection({
						entry: entry({
							provider: "custom",
							plan: "custom",
							model: "my model",
						}),
						requestsPerFiveHour: null,
						requestsPerWeek: null,
					}),
				],
			}),
		);
		expect(text).toContain("free");
		expect(text).toContain("∞");
		expect(text).toContain("custom");
		expect(text).toContain("—");
	});

	test("the account line appears only when the account answered", () => {
		expect(renderText(report())).not.toContain("CC account");
		expect(
			renderText(
				report({
					account: {
						plan: "GOAT",
						requests: 1_787,
						periodEnd: "2026-10-27",
					},
				}),
			),
		).toContain("CC account  1,787 reqs");
	});

	test("an empty catalogue says so instead of printing a header", () => {
		const text = renderText(report({ projections: [], total: 0 }));
		expect(text).toContain("no model rows to price");
		expect(text).not.toContain("req/5h");
	});

	test("a noisier table says what it is missing", () => {
		expect(renderText(report({ total: 91 }))).toContain(
			"showing 1 of 91 model-plans",
		);
	});
});
