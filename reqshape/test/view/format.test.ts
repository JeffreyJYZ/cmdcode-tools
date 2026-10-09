import { describe, expect, test } from "bun:test";
import {
	fmtCount,
	fmtDate,
	fmtInt,
	fmtPair,
	fmtUsd,
	pad,
	prettyModel,
	setColorMode,
} from "#~/view/format.ts";

setColorMode(false);

describe("format", () => {
	test("fmtCount keeps magnitudes readable and infinities honest", () => {
		expect(fmtCount(0.5)).toBe("0.5");
		expect(fmtCount(433)).toBe("433");
		expect(fmtCount(9_500)).toBe("9.5K");
		expect(fmtCount(248_000)).toBe("248.0K");
		expect(fmtCount(2_400_000)).toBe("2.4M");
		expect(fmtCount(Number.POSITIVE_INFINITY)).toBe("∞");
	});

	test("fmtInt is for counts, and groups them", () => {
		expect(fmtInt(9)).toBe("9");
		expect(fmtInt(1_084)).toBe("1,084");
		expect(fmtInt(Number.POSITIVE_INFINITY)).toBe("∞");
	});

	test("fmtUsd stays fixed-point and never goes scientific", () => {
		expect(fmtUsd(0)).toBe("free");
		expect(fmtUsd(0.0022531)).toBe("$0.0022531");
		expect(fmtUsd(0.000348)).toBe("$0.000348");
		expect(fmtUsd(12.5)).toBe("$12.5");
		expect(fmtUsd(Number.POSITIVE_INFINITY)).toBe("∞");
	});

	test("fmtDate renders a day, and nothing as an em dash", () => {
		expect(fmtDate(Date.UTC(2026, 6, 10))).toBe("2026-07-10");
		expect(fmtDate(0)).toBe("—");
	});

	test("fmtPair is a percentile pair", () => {
		expect(fmtPair(1_900, 651_100)).toBe("1.9K/651.1K");
	});

	test("pad aligns and truncates rather than wrapping", () => {
		expect(pad("ab", 4)).toBe("ab  ");
		expect(pad("ab", 4, "right")).toBe("  ab");
		expect(pad("abcdefgh", 5)).toBe("abcd…");
		expect(pad("ab", 2)).toBe("ab");
	});

	test("prettyModel drops the vendor prefix, which is noise here", () => {
		expect(prettyModel("deepseek/deepseek-v4.1-flash")).toBe(
			"deepseek-v4.1-flash",
		);
		expect(prettyModel("auto/best-coding")).toBe("best-coding");
		expect(prettyModel("hy3-free")).toBe("hy3-free");
		expect(prettyModel("")).toBe("unknown");
	});
});
