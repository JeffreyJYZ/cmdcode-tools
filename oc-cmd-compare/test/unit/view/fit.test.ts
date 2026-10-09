import { describe, expect, test } from "bun:test";
import { fitColumns, tableWidth } from "#~/view/render.ts";
import { row } from "../fixtures.ts";

describe("fitColumns", () => {
	test("drops optional columns symmetrically to fit", () => {
		const rows = [row("a", 1, 2), row("b", 3, 2)];
		const wide = [
			"model",
			"oc-rates",
			"oc-allow",
			"oc-per1k",
			"cc-rates",
			"cc-allow",
			"cc-per1k",
			"win",
			"cost",
		];
		const before = tableWidth(rows, wide);
		const fit = fitColumns(rows, wide, 40);
		expect(fit.width).toBeLessThan(before);
		expect(fit.dropped).toContain("oc-rates");
		expect(fit.dropped).toContain("cc-rates");
		// rates dropped from both sides or neither, never one.
		expect(fit.ids.includes("oc-rates")).toBe(fit.ids.includes("cc-rates"));
	});

	test("never drops columns without a drop priority", () => {
		const rows = [row("a", 1, 2)];
		const ids = ["model", "oc-allow", "cc-allow", "win", "cost"];
		const fit = fitColumns(rows, ids, 5);
		expect(fit.ids).toEqual(ids);
	});

	test("keeps everything when it already fits", () => {
		const rows = [row("a", 1, 2)];
		const ids = ["model", "win", "cost"];
		const fit = fitColumns(rows, ids, 10_000);
		expect(fit.ids).toEqual(ids);
		expect(fit.dropped).toEqual([]);
	});
});
