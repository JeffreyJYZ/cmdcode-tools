import { describe, expect, test } from "bun:test";
import { answeredByCac } from "#~/cli/flags.ts";
import { parseArgs } from "#~/cli/parse.ts";
import { DEFAULT_KEYWORDS } from "#~/constants/keywords.ts";

// cac handles -h/-v by exiting the process, so tests must not pass them.
describe("parseArgs", () => {
	test("defaults describe the tool's intent", () => {
		const options = parseArgs([]);
		expect(options.sessions).toBe("all");
		expect(options.weight).toBe("turn");
		expect(options.keepTrivial).toBe(false);
		expect(options.keywords).toEqual(DEFAULT_KEYWORDS);
		expect(options.minChars).toBe(0);
		expect(options.sort).toBe("reqmo");
		expect(options.format).toBe("text");
		expect(options.color).toBe("auto");
		expect(options.account).toBe(true);
		expect(options.custom).toBeNull();
	});

	test("every declared flag actually lands on its option", () => {
		// A flag whose key never arrives is invisible: cac leaves a name with a
		// digit after the dash (`--cap-5h`) hyphenated, so that shape is avoided
		// and the mapping is asserted here.
		const options = parseArgs([
			"--sessions",
			"user",
			"--weight",
			"session",
			"--min-chars",
			"12",
			"--min-output",
			"200",
			"--since",
			"2026-09-01",
			"--project",
			"/dev/one",
			"--model",
			"deepseek",
			"--limit",
			"5",
			"--sort",
			"cost",
			"--format",
			"json",
			"--explain",
			"--keep-trivial",
		]);
		expect(options.sessions).toBe("user");
		expect(options.weight).toBe("session");
		expect(options.minChars).toBe(12);
		expect(options.minOutput).toBe(200);
		expect(options.since).toBe(Date.parse("2026-09-01"));
		expect(options.project).toBe("/dev/one");
		expect(options.model).toBe("deepseek");
		expect(options.limit).toBe(5);
		expect(options.sort).toBe("cost");
		expect(options.format).toBe("json");
		expect(options.explain).toBe(true);
		expect(options.keepTrivial).toBe(true);
	});

	test("a custom model carries its rates, budget and window caps", () => {
		const options = parseArgs([
			"--in",
			"0.15",
			"--out",
			"0.6",
			"--cache-read",
			"0.003",
			"--budget",
			"60",
			"--five-hour",
			"12",
			"--weekly",
			"30",
			"--label",
			"my model",
		]);
		expect(options.custom).toEqual({
			label: "my model",
			input: 0.15,
			output: 0.6,
			cacheRead: 0.003,
			cacheWrite: null,
			budget: 60,
			cap5h: 12,
			capWeek: 30,
		});
	});

	test("custom rates without a budget are refused", () => {
		expect(() => parseArgs(["--in", "1", "--out", "2"])).toThrow(
			/--budget <usd> is required/,
		);
	});

	test("a lone window cap or label is not silently dropped", () => {
		// `customOf` used to watch only the rate/budget flags, so these parsed
		// and then vanished (`custom: null`). They now demand the full spec.
		expect(() => parseArgs(["--five-hour", "12"])).toThrow(
			/--budget <usd> is required/,
		);
		expect(() => parseArgs(["--weekly", "30"])).toThrow(
			/--budget <usd> is required/,
		);
		expect(() => parseArgs(["--label", "x"])).toThrow(
			/--budget <usd> is required/,
		);
	});

	test("negations read as the option being off", () => {
		expect(parseArgs(["--no-account"]).account).toBe(false);
		expect(parseArgs(["--no-color"]).color).toBe("never");
		expect(parseArgs([]).account).toBe(true);
	});

	// Asserted on the predicate rather than by parsing `-h`: cac prints the help
	// and *could* grow a process.exit here, which would take the test runner with
	// it.
	test("a request for help or version is recognised as already answered", () => {
		expect(answeredByCac({ help: true })).toBe(true);
		expect(answeredByCac({ version: true })).toBe(true);
		expect(answeredByCac({ h: true })).toBe(false);
		expect(answeredByCac({})).toBe(false);
		expect(parseArgs([]).handled).toBe(false);
	});

	test("a replacement keyword list is normalised, and empty means none", () => {
		expect(parseArgs(["--keywords", "Nope, Yep"]).keywords).toEqual([
			"nope",
			"yep",
		]);
		expect(parseArgs(["--keywords", ""]).keywords).toEqual([]);
	});

	test("a bad value fails loudly rather than silently defaulting", () => {
		expect(() => parseArgs(["--sort", "nope"])).toThrow(/--sort expects/);
		expect(() => parseArgs(["--sessions", "some"])).toThrow(
			/--sessions expects/,
		);
		expect(() => parseArgs(["--min-chars", "-1"])).toThrow(
			/--min-chars expects a number/,
		);
		expect(() => parseArgs(["--since", "whenever"])).toThrow(
			/--since expects a date/,
		);
	});

	test("binaries and the store path can be pointed elsewhere", () => {
		const options = parseArgs([
			"--db",
			"/tmp/x.db",
			"--mpc",
			"/tmp/mpc",
			"--cmduse",
			"/tmp/cmduse",
		]);
		expect(options.db).toBe("/tmp/x.db");
		expect(options.mpc).toBe("/tmp/mpc");
		expect(options.cmduse).toBe("/tmp/cmduse");
	});
});
