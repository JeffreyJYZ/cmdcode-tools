import { cac } from "cac";
import pkg from "../../package.json" with { type: "json" };
import {
	answeredByCac,
	customOf,
	keywordList,
	number,
	oneOf,
	sinceOf,
	str,
} from "./flags.ts";
import { defaultOptions, type Options } from "./options.ts";

export function parseArgs(argv: string[]): Options {
	const cli = cac("reqshape");
	cli.option("--sessions <mode>", "all | user — user drops subagent sessions")
		.option(
			"--weight <mode>",
			"turn | session — which mean the projection prices",
		)
		.option("--keep-trivial", "profile every prompt, noise included")
		.option(
			"--keywords <list>",
			"comma-separated prompts counted as noise (replaces the default list)",
		)
		.option(
			"--min-chars <n>",
			"also drop prompts shorter than this (0 = off)",
		)
		.option(
			"--min-output <n>",
			"also drop asks producing fewer output tokens (0 = off)",
		)
		.option("--since <date>", "only asks on or after this date")
		.option("--project <dir>", "only sessions under this directory")
		.option("--model <text>", "only model rows whose name contains this")
		.option("--limit <n>", "cap the number of model rows")
		.option("--sort <key>", "reqmo | cost | name")
		.option("--in <rate>", "custom model: input $/M tokens")
		.option("--out <rate>", "custom model: output $/M tokens")
		.option("--cache-read <rate>", "custom model: cache-read $/M tokens")
		.option("--cache-write <rate>", "custom model: cache-write $/M tokens")
		.option("--budget <usd>", "custom model: monthly allowance")
		.option("--five-hour <usd>", "custom model: five-hour cap")
		.option("--weekly <usd>", "custom model: weekly cap")
		.option("--label <name>", "custom model: display name")
		.option(
			"--db <path>",
			"opencode store (default ~/.local/share/opencode/opencode.db)",
		)
		.option("--mpc <bin>", "mpc binary (else MPC_BIN)")
		.option("--cmduse <bin>", "cmduse binary (else CMDUSE_BIN)")
		.option("--no-account", "skip the cmduse account line")
		.option("--color <mode>", "auto | always | never")
		.option("--explain", "list every drop reason rather than the top few")
		.option("--format <mode>", "text | json");
	cli.help();
	cli.version(pkg.version);
	cli.example("reqshape");
	cli.example("reqshape --weight session --sort cost");
	cli.example("reqshape --in 0.15 --out 0.6 --cache-read 0.003 --budget 60");

	const { options: flags } = cli.parse(["node", "reqshape", ...argv], {
		run: false,
	});
	const raw = (flags ?? {}) as Record<string, unknown>;
	const options = defaultOptions();

	options.sessions =
		oneOf(raw.sessions, ["all", "user"], "sessions") ?? options.sessions;
	options.weight =
		oneOf(raw.weight, ["turn", "session"], "weight") ?? options.weight;
	options.sort =
		oneOf(raw.sort, ["reqmo", "cost", "name"], "sort") ?? options.sort;
	options.format =
		oneOf(raw.format, ["text", "json"], "format") ?? options.format;
	// cac negates a declared flag itself, so --no-color arrives as `false`.
	options.color =
		raw.color === false
			? "never"
			: (oneOf(raw.color, ["auto", "always", "never"], "color") ??
				options.color);

	options.keepTrivial = raw.keepTrivial === true;
	options.keywords = keywordList(raw.keywords) ?? options.keywords;
	options.minChars = number(raw.minChars, "min-chars");
	options.minOutput = number(raw.minOutput, "min-output");
	options.limit = number(raw.limit, "limit");
	options.since = sinceOf(raw.since);
	options.project = str(raw.project) ?? "";
	options.model = str(raw.model) ?? "";
	options.explain = raw.explain === true;
	options.account = raw.account !== false;
	options.handled = answeredByCac(raw);
	options.db = str(raw.db) ?? options.db;
	options.mpc = str(raw.mpc) ?? options.mpc;
	options.cmduse = str(raw.cmduse) ?? options.cmduse;
	options.custom = customOf(raw);

	return options;
}
