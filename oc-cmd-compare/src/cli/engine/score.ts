import type { ScaleMode } from "#~/cli/options.ts";
import type { EntryMetrics } from "#~/types.ts";
import { logMinmax, minmax } from "./cost.ts";

/** Everything the scorer can be told to do differently. */
export interface ScoreConfig {
	abilityWeight: number;
	tpsWeight: number;
	/** ability, tps, volume, cache, output — normalised to sum 1. */
	valWeights?: number[];
	scale: ScaleMode;
	inheritSuffixes?: string[];
	window?: [number, number];
}

function normalise(
	weights: number[] | undefined,
	fallback: number[],
): number[] {
	const values =
		weights && weights.length === fallback.length ? weights : fallback;
	const total = values.reduce((a, b) => a + b, 0);
	return total > 0 ? values.map((v) => v / total) : fallback;
}

const scale = (values: number[], mode: ScaleMode): number[] =>
	mode === "linear" ? minmax(values) : logMinmax(values);

/** COST index (inverted for display, so 0 = most requests = best): volume only,
 * the log-scaled requests/month, min-max normalised across every entry. Cache
 * and output prices are their own columns and are deliberately not folded in —
 * "cost" here means "how many requests the plan buys". */
export function assignIndex(metrics: EntryMetrics[]): void {
	const priced = metrics.filter((m) => Number.isFinite(m.requestsPerMonth));
	const volume = minmax(
		priced.map((m) => Math.log10(Math.max(m.requestsPerMonth, 1))),
	);

	priced.forEach((m, i) => {
		m.index = Math.round(100 * (volume[i] ?? 0.5));
	});
	for (const m of metrics) {
		if (!Number.isFinite(m.requestsPerMonth)) m.index = 100;
		else if (m.requestsPerMonth <= 0) m.index = 0;
	}
}

/** VAL: ability / speed / volume / cache / output. Unscored models stay null. */
export function assignValueIndex(
	metrics: EntryMetrics[],
	config: ScoreConfig,
): void {
	const weights = normalise(config.valWeights, [
		config.abilityWeight,
		config.tpsWeight,
		(1 - config.abilityWeight - config.tpsWeight) * 0.5,
		(1 - config.abilityWeight - config.tpsWeight) * 0.25,
		(1 - config.abilityWeight - config.tpsWeight) * 0.25,
	]);
	const [wAbility, wTps, wVolume, wCache, wOutput] = weights;
	const scored = metrics.filter((m) => m.ability !== null);
	const priced = metrics.filter((m) => Number.isFinite(m.requestsPerMonth));
	const speeded = metrics.filter((m) => m.tps !== null);

	const ability = minmax(scored.map((m) => m.ability ?? 0));
	const speed = scale(
		speeded.map((m) => m.tps ?? 1),
		config.scale,
	);
	const volume = minmax(
		priced.map((m) => Math.log10(Math.max(m.requestsPerMonth, 1))),
	);
	const cache = scale(
		priced.map((m) => m.pricing.cacheRead),
		config.scale,
	);
	const output = scale(
		priced.map((m) => m.pricing.output),
		config.scale,
	);

	const of = <T>(items: T[], values: number[]): Map<T, number> =>
		new Map(items.map((item, i) => [item, values[i] ?? 0.5]));
	const byVolume = of(priced, volume);
	const byCache = of(priced, cache);
	const byOutput = of(priced, output);
	const byAbility = of(scored, ability);
	const bySpeed = of(speeded, speed);

	// Unpriced models have unlimited requests, so they sit at the top of the
	// scale and stay out of the range below.
	const composites = new Map<EntryMetrics, number>();
	for (const m of scored) {
		if (!Number.isFinite(m.requestsPerMonth)) {
			m.valueIndex = 100;
			continue;
		}
		composites.set(
			m,
			100 * (wAbility ?? 0) * (byAbility.get(m) ?? 0.5) +
				100 * (wTps ?? 0) * (bySpeed.get(m) ?? 0.5) +
				100 * (wVolume ?? 0) * (byVolume.get(m) ?? 0.5) +
				100 * (wCache ?? 0) * (1 - (byCache.get(m) ?? 0.5)) +
				100 * (wOutput ?? 0) * (1 - (byOutput.get(m) ?? 0.5)),
		);
	}
	// The weighted sum alone tops out in the sixties: no entry leads every term
	// (the volume winner has no ability, the speed winner is mid-pack on volume),
	// so the raw number reads as "everything is mediocre". Rescale across entries
	// — the way COST does — so the best reads 100 and the spread is legible.
	const values = [...composites.values()];
	const low = values.length > 0 ? Math.min(...values) : 0;
	const high = values.length > 0 ? Math.max(...values) : 0;
	for (const [m, value] of composites) {
		m.valueIndex =
			high > low ? Math.round((100 * (value - low)) / (high - low)) : 100;
	}
}
