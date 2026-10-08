import { describe, expect, test } from "bun:test";
import { BOUNDARY } from "~/constants/data.ts";
import { parseMoney } from "~/data/scrape/index.ts";

describe("parseMoney", () => {
	test("plain price", () => {
		expect(parseMoney("$0.15")).toBe(0.15);
	});
	test("high-precision price", () => {
		expect(parseMoney("$0.08334")).toBe(0.08334);
	});
	test("free", () => {
		expect(parseMoney("Free")).toBe(0);
	});
	test("dash is null", () => {
		expect(parseMoney("—")).toBeNull();
	});
	test("strikethrough picks the current price", () => {
		expect(
			parseMoney(`$2.00${BOUNDARY}$1.20${BOUNDARY}+1${BOUNDARY}`),
		).toBe(1.2);
	});
	test("trailing multiplier note is not merged", () => {
		expect(
			parseMoney(
				`$15${BOUNDARY} $60${BOUNDARY}4x · Ends Sep 27${BOUNDARY}`,
			),
		).toBe(60);
	});
});
