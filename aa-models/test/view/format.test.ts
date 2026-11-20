import { describe, expect, test } from "bun:test";
import {
	EMPTY,
	clip,
	colorEnabled,
	fmtCount,
	fmtDate,
	fmtOpen,
	fmtPrice,
	fmtScore,
	fmtSeconds,
	fmtTps,
	pad,
	paint,
} from "#~/view/format.ts";

describe("scores", () => {
	test("one decimal, and a null stays an em dash", () => {
		expect(fmtScore(72.44)).toBe("72.4");
		expect(fmtScore(68)).toBe("68.0");
		expect(fmtScore(null)).toBe(EMPTY);
		expect(fmtTps(120.56)).toBe("120.6");
		expect(fmtTps(undefined as unknown as null)).toBe(EMPTY);
		expect(fmtSeconds(0.42)).toBe("0.42");
	});

	test("a value that rounds to zero never prints as -0", () => {
		expect(fmtScore(-0.04)).toBe("0.0");
		expect(fmtPrice(-0.0001)).toBe("$0");
	});
});

describe("counts and prices", () => {
	test("context tokens read in K and M, never in scientific notation", () => {
		expect(fmtCount(200000)).toBe("200K");
		expect(fmtCount(1000000)).toBe("1.0M");
		expect(fmtCount(128000)).toBe("128K");
		expect(fmtCount(8192)).toBe("8.2K");
		expect(fmtCount(999)).toBe("999");
		expect(fmtCount(null)).toBe(EMPTY);
	});

	test("token prices keep the small digits and trim the rest", () => {
		expect(fmtPrice(0.15)).toBe("$0.15");
		expect(fmtPrice(2.5)).toBe("$2.5");
		expect(fmtPrice(15)).toBe("$15");
		expect(fmtPrice(0.075)).toBe("$0.075");
		expect(fmtPrice(0)).toBe("$0");
		expect(fmtPrice(null)).toBe(EMPTY);
	});

	test("dates and the open-weights tri-state", () => {
		expect(fmtDate("2026-09-01")).toBe("2026-09-01");
		expect(fmtDate(null)).toBe(EMPTY);
		expect(fmtOpen(true)).toBe("open");
		expect(fmtOpen(false)).toBe("closed");
		expect(fmtOpen(null)).toBe(EMPTY);
	});
});

describe("layout", () => {
	test("clip marks the cut instead of dropping characters silently", () => {
		expect(clip("abcdef", 4)).toBe("abc…");
		expect(clip("abc", 4)).toBe("abc");
		expect(clip("abc", 0)).toBe("");
		expect(pad("ab", 4, "right")).toBe("  ab");
		expect(pad("ab", 4, "left")).toBe("ab  ");
	});
});

describe("colour", () => {
	test("auto follows the tty, always and never override it, NO_COLOR wins", () => {
		expect(colorEnabled("auto", true, false)).toBe(true);
		expect(colorEnabled("auto", false, false)).toBe(false);
		expect(colorEnabled("always", false, false)).toBe(true);
		expect(colorEnabled("never", true, false)).toBe(false);
		expect(colorEnabled("always", true, true)).toBe(false);
	});

	test("paint is a no-op when colour is off", () => {
		expect(paint("x", "\x1b[1m", false)).toBe("x");
		expect(paint("x", "\x1b[1m", true)).toBe("\x1b[1mx\x1b[0m");
	});
});
