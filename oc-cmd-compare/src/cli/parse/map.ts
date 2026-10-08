import {
	type Format,
	type Metric,
	type Options,
	parseFormat,
	parseMetric,
	parseOnly,
	type ScaleMode,
} from "~/cli/options.ts";
import { ARG_DEFAULTS, BENCH_DEFAULT } from "~/constants/cli.ts";
import { SHAPE_MEASURED } from "~/constants/shape.ts";
import {
	colorMode,
	numbers,
	pair,
	presets,
	usageWindow,
	words,
} from "./fields.ts";
import { assertKnown, assertValues, type Bag, int, share } from "./validate.ts";

export type { Bag } from "./validate.ts";

const pick = (bag: Bag, key: string): unknown =>
	bag[key] === undefined
		? ARG_DEFAULTS[key as keyof typeof ARG_DEFAULTS]
		: bag[key];

/** `--bench` default is contextual: the AA API leads only when a key exists. */
function benchDefault(bag: Bag): string {
	const keyed = bag.aaKey !== undefined || Boolean(process.env.AA_API_KEY);
	return keyed ? BENCH_DEFAULT.keyed : BENCH_DEFAULT.keyless;
}

/** Reduce the merged bag (plugins < config < CLI) to Options. */
export function toOptions(bag: Bag): Options {
	assertKnown(bag);
	assertValues(bag);
	const columns = bag.columns === undefined ? undefined : String(bag.columns);
	const window = numbers(bag, "window");
	return {
		ccPlan: String(pick(bag, "ccPlan")),
		workload: {
			input: int("in", pick(bag, "in")),
			cacheRead: int("cache", pick(bag, "cache")),
			output: int("out", pick(bag, "out")),
			reasoning: int("reasoning", pick(bag, "reasoning")),
			cacheWrite: int("cache-write", pick(bag, "cacheWrite")),
		},
		// A bare `--shape` means "measure it" (`cac` yields `true`); no flag at
		// all leaves the default (`auto`, which trusts reqshape when it has data).
		shape: bag.shape === true ? SHAPE_MEASURED : String(pick(bag, "shape")),
		since: bag.since === undefined ? undefined : String(bag.since),
		metric: parseMetric(String(pick(bag, "metric"))) as Metric,
		model: bag.model === undefined ? undefined : String(bag.model),
		only: parseOnly(String(pick(bag, "only"))),
		columns:
			columns === undefined
				? undefined
				: columns
						.split(",")
						.map((c) => c.trim())
						.filter(Boolean),
		preset: bag.preset === undefined ? undefined : String(bag.preset),
		presets: presets(bag),
		detail: bag.detail === true,
		minimal: bag.minimal === true,
		medium: bag.medium === true,
		// Width 0 is meaningless and silently disabled trimming; cac coerces a
		// blank `--width ""` to 0, so require at least one column.
		width: bag.width === undefined ? undefined : int("width", bag.width, 1),
		fit: bag.fit !== false,
		bench: bag.bench === undefined ? benchDefault(bag) : String(bag.bench),
		benchWeight: share("bench-weight", pick(bag, "benchWeight")),
		tpsWeight: share("tps-weight", pick(bag, "tpsWeight")),
		valWeights: numbers(bag, "valWeights"),
		scale: String(pick(bag, "scale")) as ScaleMode,
		// Absent means "use the built-in suffixes"; an empty list means "inherit
		// nothing", which is why this must stay undefined rather than become []:
		// the lookups read an empty array as a deliberate opt-out.
		inheritSuffixes: (() => {
			const suffixes = words(bag, "inheritSuffixes");
			return suffixes.length > 0 ? suffixes : undefined;
		})(),
		window:
			window && window.length === 2
				? [window[0] ?? 0, window[1] ?? 0]
				: undefined,
		costThresholds: pair(pick(bag, "costThresholds"), "cost-thresholds"),
		valThresholds: pair(pick(bag, "valThresholds"), "val-thresholds"),
		benchName:
			bag.benchName === undefined ? undefined : String(bag.benchName),
		aaKey: bag.aaKey === undefined ? undefined : String(bag.aaKey),
		noFallback: bag.fallback === false,
		refresh: bag.refresh === true,
		noAbility: bag.ability === false,
		peak: bag.peak === true,
		asc: bag.asc === true,
		json: bag.json === true,
		format: parseFormat(
			bag.format === undefined ? "table" : String(bag.format),
		) as Format,
		colorMode: colorMode(bag.color),
		check: bag.check === true,
		printConfig: bag.printConfig === true,
		usage: bag.usage === true,
		usageFile:
			bag.usageFile === undefined ? undefined : String(bag.usageFile),
		usageLog: bag.usageLog === undefined ? undefined : String(bag.usageLog),
		usageDb: bag.usageDb === undefined ? undefined : String(bag.usageDb),
		usageMonths:
			bag.usageMonths === undefined ? 1 : Number(bag.usageMonths),
		usageWindow: usageWindow(bag.usageWindow),
		plugins: words(bag, "plugins"),
	};
}
