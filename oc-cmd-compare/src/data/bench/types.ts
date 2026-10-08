export type AbilitySource = "cc" | "aa" | "aa-web" | "file" | "url";

/** Benchmark data, keyed by canonical model key. */
export interface BenchData {
	intelligence: Map<string, number>;
	/** Output tokens per second, when the source publishes it. */
	tps: Map<string, number>;
}

export interface AbilityResult extends BenchData {
	label: string;
	/** Note about coverage limits, shown in the footer. */
	note?: string;
}

export interface AbilityOptions {
	source: string;
	key?: string;
	/** Only these model keys matter; fills outside the catalog are ignored. */
	keys?: Set<string>;
	/** Fill models the primary source misses from the other sources. */
	fallback?: boolean;
	refresh?: boolean;
}

export interface Resolved {
	scheme: AbilitySource;
	data: BenchData;
	label: string;
}

export function emptyData(): BenchData {
	return { intelligence: new Map(), tps: new Map() };
}
