import { cac } from "cac";
import type { Options } from "#~/cli/options.ts";
import pkg from "../../../package.json" with { type: "json" };
import { type Bag, toOptions } from "./map.ts";

/** Raw CLI bag: exactly what the user typed, no config, no defaults. */
export function parseFlags(argv: string[]): Bag {
	const cli = cac("mpc");
	cli.option(
		"--cc-plan <id>",
		"CommandCode plan: go, goat, pro, max10, max20",
	)
		.option("--in <n>", "input tokens per request")
		.option("--cache <n>", "cache-read tokens per request")
		.option("--out <n>", "output tokens per request")
		.option(
			"--reasoning <n>",
			"reasoning tokens, billed at the output rate",
		)
		.option("--cache-write <n>", "cache-write tokens per request")
		.option(
			"--shape <spec>",
			"auto | measured | <file> | off: reqshape shape (auto = measured with enough data)",
		)
		.option(
			"--since <date>",
			"measured shape: only requests on or after this date",
		)
		.option("--metric <name>", "val | cost | perreq | req | name")
		.option("--model <re>", "only rows whose name matches")
		.option("--only <scope>", "both | all")
		.option(
			"--minimal",
			"fewest columns: model + req/mo each side + win + val",
		)
		.option(
			"--medium",
			"allowance and the rate views per side + win + cost + val",
		)
		.option(
			"--no-fit",
			"keep the preset's full width, do not trim to the terminal",
		)
		.option("--detail", "every column, untrimmed")
		.option("--width <n>", "force table width")
		.option(
			"--columns <ids>",
			"comma-separated columns (--columns help to list)",
		)
		.option("--preset <name>", "named column preset from config")
		.option(
			"--bench <src>",
			"cc | aa | aa-web | file:<path> | url:<url> (aa with a key, else cc)",
		)
		.option("--bench-weight <n>", "ability share of VAL")
		.option("--tps-weight <n>", "speed share of VAL")
		.option("--val-weights <w>", "ability,tps,volume,cache,output shares")
		.option("--scale <mode>", "log | linear for skewed terms")
		.option(
			"--inherit-suffixes <s>",
			"comma-separated speed-variant suffixes",
		)
		.option("--window <pair>", "override five-hour,weekly window ratios")
		.option("--cost-thresholds <p>", "green,yellow COST cut-offs")
		.option("--val-thresholds <p>", "yellow,green VAL cut-offs")
		.option("--bench-name <label>", "footer label for the source")
		.option("--aa-key <key>", "Artificial Analysis key (else AA_API_KEY)")
		.option("--no-fallback", "do not fill misses from other sources")
		.option("--refresh", "ignore the aa-web cache")
		.option("--no-ability", "hide ability and VAL")
		.option("--peak", "peak-rate rows (OpenCode DeepSeek)")
		.option("--asc", "flip the default sort direction")
		.option("--json", "machine-readable output")
		.option("--format <name>", "table | json | csv | md")
		.option("--color <mode>", "auto | always | never")
		.option("--check", "validate live sources and exit")
		.option(
			"--config <path>",
			"config file (default: ~/.config/mpc/config.json)",
		)
		.option("--no-config", "ignore the config file")
		.option("--plugin <paths>", "extra config plugins, comma-separated")
		.option("--print-config", "print the effective settings and exit")
		.option(
			"--usage",
			"project your real usage from cmduse onto both plans",
		)
		.option("--usage-file <path>", "read usage from a JSON file instead")
		.option(
			"--usage-window <w>",
			"usage range: period | all | <n>d (default period)",
		)
		.option(
			"--usage-db <path>",
			"opencode message store (default ~/.local/share/opencode/opencode.db)",
		)
		.option(
			"--usage-log <path>",
			"provider usage log (default ~/.cache/mpc/usage.jsonl)",
		)
		.option(
			"--usage-months <n>",
			"treat the logged usage as covering N months",
		);
	cli.help();
	cli.version(pkg.version);
	const parsed = cli.parse(["node", "mpc", ...argv], { run: false });
	return (parsed.options ?? {}) as Bag;
}

/** CLI-only options, with defaults. Config is applied by resolveOptions. */
export function parseArgs(argv: string[]): Options {
	return toOptions(parseFlags(argv));
}
