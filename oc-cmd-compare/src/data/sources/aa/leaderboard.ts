import { type BenchData, emptyData } from "#~/data/bench/types.ts";
import { aaKeyVariants } from "#~/keys.ts";
import { decodeFlight, readArray } from "./flight.ts";

interface LeaderboardRow {
	slug?: unknown;
	name?: unknown;
	shortName?: unknown;
	release?: { slug?: unknown; name?: unknown } | null;
	intelligenceIndex?: unknown;
	outputSpeed?: unknown;
}

/** A finite, positive number; `null` for 0, null and the string sentinels. */
function positive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Pure parser over the AA leaderboard page. Its RSC `initialModels` array holds
 * far more rows than `/models` (282 vs 27 here), each scored row keyed by
 * `release.slug` first and its display names second. Rows with a null index are
 * listed but unmeasured; never coerce them to 0. Best score per key wins, since
 * effort variants share a release slug.
 */
export function parseAaLeaderboard(html: string): BenchData {
	const data = emptyData();
	const rows = readArray(decodeFlight(html) || html, "initialModels");
	if (!rows) return data;
	for (const raw of rows) {
		const row = (raw ?? {}) as LeaderboardRow;
		const score = positive(row.intelligenceIndex);
		const speed = positive(row.outputSpeed);
		if (score === null && speed === null) continue;
		const keys = new Set<string>();
		for (const value of [
			row.release?.slug,
			row.slug,
			row.name,
			row.shortName,
			row.release?.name,
		]) {
			if (typeof value === "string") for (const k of aaKeyVariants(value)) keys.add(k);
		}
		for (const key of keys) {
			if (score !== null && score > (data.intelligence.get(key) ?? 0)) {
				data.intelligence.set(key, score);
			}
			if (speed !== null && speed > (data.tps.get(key) ?? 0)) data.tps.set(key, speed);
		}
	}
	return data;
}
