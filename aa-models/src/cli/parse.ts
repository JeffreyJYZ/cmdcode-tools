import { cac } from "cac";
import pkg from "../../package.json" with { type: "json" };

/** Raw parsed bag, plus whether cac already answered `--help`/`--version`. */
export interface Parsed {
	bag: Record<string, unknown>;
	help: boolean;
	version: boolean;
	command: "list" | "model" | "fields" | "check";
	query?: string;
}

/** Flag names that always take a value; a bare use must fail, not become `true`. */
export const VALUED = new Set([
	"model",
	"creator",
	"where",
	"minIntel",
	"maxIntel",
	"minTps",
	"maxTps",
	"minContext",
	"since",
	"sort",
	"rows",
	"columns",
	"format",
	"aaKey",
	"cache",
	"width",
	"color",
]);

/** Every key cac may emit, so an undeclared flag is caught rather than ignored. */
export const KNOWN = new Set([
	...VALUED,
	"scored",
	"unscored",
	"openWeights",
	"closedWeights",
	"asc",
	"json",
	"raw",
	"api",
	"refresh",
	"check",
	"fields",
	"help",
	"h",
	"version",
	"v",
	"--",
]);

const SUBCOMMANDS = new Set(["model", "fields", "check"]);

export function parseArgv(argv: string[]): Parsed {
	const cli = cac("aam");
	cli.option("--model <re>", "name/slug/creator regex (or substring when invalid)")
		.option("--creator <list>", "comma-separated creators, exact and case-insensitive")
		.option("--where <expr>", "path op value (repeatable): = != > >= < <= ~")
		.option("--scored", "only models with an intelligence index")
		.option("--unscored", "only models without an intelligence index")
		.option("--min-intel <n>", "minimum intelligence index")
		.option("--max-intel <n>", "maximum intelligence index")
		.option("--min-tps <n>", "minimum output tokens/second")
		.option("--max-tps <n>", "maximum output tokens/second")
		.option("--min-context <n>", "minimum context window in tokens")
		.option("--open-weights", "only open-weights models")
		.option("--closed-weights", "only closed-weights models")
		.option("--since <date>", "released on or after YYYY-MM-DD")
		.option(
			"--sort <field>",
			"dot-path or alias: intelligence, tps, context, price, released, name",
		)
		.option("--asc", "ascending order (nulls still last)")
		.option("--rows <n>", "cap table rows; 0 = all")
		.option("--columns <ids>", "comma-separated column ids (--columns help to list)")
		.option("--format <name>", "table | json | csv | md")
		.option("--json", "machine-readable output (same as --format json)")
		.option("--raw", "include each model's untouched upstream record in JSON")
		.option("--no-api", "skip the API even when a key exists")
		.option("--aa-key <key>", "Artificial Analysis API key (else AA_API_KEY)")
		.option("--refresh", "refetch, ignoring the cache")
		.option("--cache <dur>", "cache TTL: 0, 30s, 15m, 6h, 1d (default 1h)")
		.option("--width <n>", "table width")
		.option("--color <mode>", "auto | always | never")
		.option("--check", "validate each source and exit")
		.option("--fields", "list every field present across the catalogue");
	cli.command("model <query>", "one model's full record");
	cli.command("fields", "every field present, with coverage counts");
	cli.command("check", "validate each source");
	cli.help();
	cli.version(pkg.version);
	cli.example("aam --rows 10 --sort tps");
	cli.example("aam model deepseek-v4.1-flash --json");
	cli.example("aam --where price.blended\\<1 --open-weights");

	const parsed = cli.parse(["node", "aam", ...argv], { run: false });
	const bag = (parsed.options ?? {}) as Record<string, unknown>;
	const help = bag.help === true || bag.h === true;
	const version = bag.version === true || bag.v === true;
	// cac strips the subcommand from args but records which one matched.
	const name = cli.matchedCommandName;
	const command = name !== undefined && SUBCOMMANDS.has(name) ? name : "list";
	const query = command === "model" ? parsed.args[0] : undefined;
	return {
		bag,
		help,
		version,
		command: command as Parsed["command"],
		query: typeof query === "string" ? query : undefined,
	};
}
