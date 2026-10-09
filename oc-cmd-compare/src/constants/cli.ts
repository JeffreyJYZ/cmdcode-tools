import type { Format, Metric } from "#~/cli/options.ts";
import { SHAPE_AUTO } from "#~/constants/shape.ts";
import { DEFAULT_OC_PLAN } from "#~/constants/sources.ts";
import {
	DETAIL_COLUMNS,
	MEDIUM_COLUMNS,
	MINIMAL_COLUMNS,
} from "#~/constants/view.ts";

/** Workload defaults asserted by `--in` / `--cache` / `--out` when unset. */
export const OPTION_DEFAULTS = {
	input: 800,
	cacheRead: 50_000,
	output: 200,
};

/**
 * `--bench` default is contextual: the AA API gives full coverage when a key
 * is available (`AA_API_KEY` / `--aa-key`), so it leads there; otherwise the
 * CommandCode scrape does.
 */
export const BENCH_DEFAULT = { keyed: "aa", keyless: "cc" } as const;

/** The raw CLI bag defaults, before config/plugin layering. */
export const ARG_DEFAULTS = {
	ccPlan: "goat",
	ocPlan: DEFAULT_OC_PLAN,
	in: 800,
	cache: 50_000,
	out: 200,
	reasoning: 0,
	cacheWrite: 0,
	shape: SHAPE_AUTO,
	metric: "val",
	only: "all",
	bench: BENCH_DEFAULT.keyless,
	benchWeight: 0.35,
	tpsWeight: 0.1,
	costThresholds: [30, 60],
	valThresholds: [40, 70],
	scale: "log",
	format: "table",
} as const;

export const METRICS: Metric[] = ["val", "cost", "perreq", "req", "name"];
export const FORMATS: Format[] = ["table", "json", "csv", "md"];

// cac registers `--help`/`--version` **and** their `-h`/`-v` aliases as separate
// keys, so all four must be tolerated here; `run` then returns before any work.
export const INTERNAL = new Set(["--", "help", "h", "version", "v"]);

export const KNOWN = new Set([
	"ccPlan",
	"ocPlan",
	"in",
	"cache",
	"out",
	"reasoning",
	"cacheWrite",
	"shape",
	"since",
	"metric",
	"model",
	"only",
	"fit",
	"bench",
	"benchWeight",
	"tpsWeight",
	"benchName",
	"aaKey",
	"fallback",
	"refresh",
	"ability",
	"peak",
	"asc",
	"json",
	"detail",
	"minimal",
	"medium",
	"width",
	"columns",
	"color",
	"check",
	"config",
	"printConfig",
	"usage",
	"usageFile",
	"usageLog",
	"usageDb",
	"usageMonths",
	"usageWindow",
	"plugins",
	"plugin",
	"preset",
	"presets",
	"format",
	"scale",
	"valWeights",
	"inheritSuffixes",
	"window",
	"costThresholds",
	"valThresholds",
]);

/**
 * Flags cac declares with a required value (`--x <v>`). Given without one, cac
 * yields the boolean `true`, which `String(...)` would quietly turn into the
 * literal "true" and be used as the value.
 *
 * Two are deliberately absent: `config` (`--no-config` makes `true` its
 * *default*, so a bare `--config` cannot be told from "use the default path")
 * and `shape` (a bare `--shape` means `measured`, handled in `map.ts`).
 */
export const VALUED = new Set([
	"ccPlan",
	"ocPlan",
	"in",
	"cache",
	"out",
	"reasoning",
	"cacheWrite",
	"since",
	"metric",
	"model",
	"only",
	"width",
	"columns",
	"preset",
	"bench",
	"benchWeight",
	"tpsWeight",
	"valWeights",
	"scale",
	"inheritSuffixes",
	"window",
	"costThresholds",
	"valThresholds",
	"benchName",
	"aaKey",
	"format",
	"color",
	"plugin",
	"usageFile",
	"usageWindow",
	"usageDb",
	"usageLog",
	"usageMonths",
]);

export const TIERS = ["minimal", "medium", "detail"] as const;
export type Tier = (typeof TIERS)[number];

export const SETS: Record<Tier, string[]> = {
	minimal: MINIMAL_COLUMNS,
	medium: MEDIUM_COLUMNS,
	detail: DETAIL_COLUMNS,
};
