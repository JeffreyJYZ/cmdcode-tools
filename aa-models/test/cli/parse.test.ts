import { describe, expect, test } from "bun:test";
import { toOptions } from "#~/cli/map.ts";
import { parseArgv } from "#~/cli/parse.ts";

const options = (...argv: string[]) => toOptions(parseArgv(argv));

describe("parse and map", () => {
	test("an undeclared flag throws and names itself", () => {
		expect(() => options("--nope")).toThrow(/unknown flag "--nope"/);
	});

	test("a value flag used bare throws with its name", () => {
		expect(() => options("--sort")).toThrow("--sort expects a value — see --help");
		expect(() => options("--min-intel")).toThrow("--min-intel expects a value");
	});

	test("--cache parses each accepted unit to ms", () => {
		expect(options().cacheMs).toBe(3_600_000);
		expect(options("--cache", "0").cacheMs).toBe(0);
		expect(options("--cache", "30s").cacheMs).toBe(30_000);
		expect(options("--cache", "15m").cacheMs).toBe(900_000);
		expect(options("--cache", "6h").cacheMs).toBe(21_600_000);
		expect(options("--cache", "1d").cacheMs).toBe(86_400_000);
	});

	test("--cache rejects anything else, listing the accepted forms", () => {
		expect(() => options("--cache", "soon")).toThrow(/30s, 15m, 6h or 1d/);
	});

	test("--scored and --unscored are mutually exclusive", () => {
		expect(() => options("--scored", "--unscored")).toThrow(/mutually exclusive/);
	});

	test("--json selects the JSON format", () => {
		const parsed = options("--json");
		expect(parsed.json).toBe(true);
		expect(parsed.format).toBe("json");
	});

	test("defaults: table, all rows, cache 1h, colour auto", () => {
		const parsed = options();
		expect(parsed.format).toBe("table");
		expect(parsed.rows).toBeUndefined();
		expect(parsed.color).toBe("auto");
		expect(parsed.command).toBe("list");
	});

	test("--rows 0 keeps zero, which the table reads as all rows", () => {
		expect(options("--rows", "0").rows).toBe(0);
		expect(options("--rows", "5").rows).toBe(5);
	});

	test("--columns help is a help request, not a column named help", () => {
		const parsed = options("--columns", "help");
		expect(parsed.columnsHelp).toBe(true);
		expect(parsed.columns).toEqual([]);
	});

	test("subcommands and the --check/--fields aliases", () => {
		expect(options("model", "glm-5.3").command).toBe("model");
		expect(options("model", "glm-5.3").query).toBe("glm-5.3");
		expect(options("check").command).toBe("check");
		expect(options("--check").command).toBe("check");
		expect(options("--fields").command).toBe("fields");
	});

	test("--no-api flips the api flag", () => {
		expect(options().noApi).toBe(false);
		expect(options("--no-api").noApi).toBe(true);
	});

	test("--creator splits a comma list", () => {
		expect(options("--creator", "openai, anthropic").creators).toEqual(["openai", "anthropic"]);
	});
});
