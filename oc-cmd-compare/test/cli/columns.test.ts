import { describe, expect, test } from "bun:test";
import { resolveColumns, trimsToWidth } from "~/cli/flow/columns.ts";
import { parseArgs } from "~/cli/run.ts";
import {
	DETAIL_COLUMNS,
	MEDIUM_COLUMNS,
	MINIMAL_COLUMNS,
} from "~/constants/view.ts";

describe("resolveColumns", () => {
	test("plain mpc is the full set, trimmed to the terminal", () => {
		const options = parseArgs([]);
		expect(resolveColumns(options)).toEqual(DETAIL_COLUMNS);
		expect(trimsToWidth(options)).toBe(true);
	});

	test("--minimal and --medium narrow the set but still trim", () => {
		for (const [flag, expected] of [
			["--minimal", MINIMAL_COLUMNS],
			["--medium", MEDIUM_COLUMNS],
		] as const) {
			const options = parseArgs([flag]);
			expect(resolveColumns(options)).toEqual(expected);
			expect(trimsToWidth(options)).toBe(true);
		}
	});

	test("--detail is the full set, untrimmed", () => {
		const options = parseArgs(["--detail"]);
		expect(resolveColumns(options)).toEqual(DETAIL_COLUMNS);
		expect(trimsToWidth(options)).toBe(false);
	});

	test("--no-fit keeps a preset's full width", () => {
		expect(trimsToWidth(parseArgs(["--medium", "--no-fit"]))).toBe(false);
	});

	test("two tiers at once is an error", () => {
		expect(() =>
			resolveColumns(parseArgs(["--minimal", "--medium"])),
		).toThrow(/conflict/);
	});

	test("--columns is exact and bypasses trimming", () => {
		const options = parseArgs(["--columns", "model,val"]);
		expect(resolveColumns(options)).toEqual(["model", "val"]);
		expect(trimsToWidth(options)).toBe(false);
	});

	test("an unknown config preset still throws", () => {
		expect(() => resolveColumns(parseArgs(["--preset", "nope"]))).toThrow(
			/unknown preset/,
		);
	});
});
