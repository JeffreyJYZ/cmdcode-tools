import { SPEED_SUFFIXES, SPEED_TPS_FACTOR } from "#~/constants/scoring.ts";

/**
 * The base key a speed variant shares weights with, or undefined. FlashX is the
 * faster tier of Flash, not of the base model.
 */
function baseKey(key: string, suffixes: string[]): string | undefined {
	if (key.endsWith("flashx")) return `${key.slice(0, -"flashx".length)}flash`;
	for (const suffix of suffixes) {
		if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
	}
	return undefined;
}

/**
 * Benchmark lookup. A speed variant has the base model's weights, so it
 * inherits the base ability when the benchmark has no row of its own.
 * `suffixes` is configurable; empty means no inheritance.
 */
export function lookupAbility(
	scores: Map<string, number>,
	key: string,
	suffixes: string[] = SPEED_SUFFIXES,
): number | null {
	const direct = scores.get(key);
	if (direct !== undefined) return direct;
	const base = baseKey(key, suffixes);
	if (base === undefined) return null;
	return scores.get(base) ?? null;
}

/**
 * Throughput lookup. A variant with its own figure wins; otherwise it borrows
 * the base's, multiplied by `factor` (see `SPEED_TPS_FACTOR`), so a speed tier
 * is not scored as if it served at the neutral rate. A base with no figure
 * either leaves the variant null.
 */
export function lookupTps(
	scores: Map<string, number>,
	key: string,
	suffixes: string[] = SPEED_SUFFIXES,
	factor: number = SPEED_TPS_FACTOR,
): number | null {
	const direct = scores.get(key);
	if (direct !== undefined) return direct;
	const base = baseKey(key, suffixes);
	if (base === undefined) return null;
	const baseTps = scores.get(base);
	return baseTps === undefined ? null : baseTps * factor;
}
