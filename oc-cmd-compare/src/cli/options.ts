import { FORMATS, METRICS } from "~/constants/cli.ts";
import type { Workload } from "~/types.ts";

export type Metric = "val" | "cost" | "perreq" | "req" | "name";
export type ColorMode = "auto" | "always" | "never";
export type ScaleMode = "log" | "linear";
export type Format = "table" | "json" | "csv" | "md";

export interface Options {
	ccPlan: string;
	workload: Workload;
	/** `off` (the default), `measured`, or a path to a saved reqshape JSON. */
	shape: string;
	/** Lower bound for the measured shape, passed through to reqshape. */
	since?: string;
	metric: Metric;
	model?: string;
	only: "both" | "all";
	columns?: string[];
	preset?: string;
	presets: Record<string, string[]>;
	detail: boolean;
	minimal: boolean;
	medium: boolean;
	width?: number;
	fit: boolean;
	bench: string;
	benchWeight: number;
	tpsWeight: number;
	valWeights?: number[];
	scale: ScaleMode;
	inheritSuffixes?: string[];
	window?: [number, number];
	costThresholds: [number, number];
	valThresholds: [number, number];
	benchName?: string;
	aaKey?: string;
	noFallback: boolean;
	refresh: boolean;
	noAbility: boolean;
	peak: boolean;
	asc: boolean;
	json: boolean;
	format: Format;
	colorMode: ColorMode;
	check: boolean;
	printConfig: boolean;
	usage: boolean;
	usageFile?: string;
	usageLog?: string;
	usageDb?: string;
	usageMonths: number;
	usageWindow: "period" | "all" | `${number}d`;
	plugins: string[];
}

export function parseMetric(value: string | undefined): Metric {
	if (!METRICS.includes(value as Metric)) {
		throw new Error(`unknown --metric "${value}"`);
	}
	return value as Metric;
}

export function parseFormat(value: string | undefined): Format {
	if (!FORMATS.includes(value as Format)) {
		throw new Error(
			`unknown --format "${value}" (table | json | csv | md)`,
		);
	}
	return value as Format;
}

export function parseOnly(value: string | undefined): "both" | "all" {
	if (value !== "both" && value !== "all") {
		throw new Error(`--only expects "both" or "all", got "${value}"`);
	}
	return value;
}
