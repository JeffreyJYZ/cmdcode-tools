import type { Profile, Req, Stats } from "~/types.ts";

export function mean(values: number[]): number {
	if (values.length === 0) return 0;
	let sum = 0;
	for (const value of values) sum += value;
	return sum / values.length;
}

/** One reader per measured field, so the metrics never drift apart anywhere. */
export const FIELDS = {
	input: (req: Req) => req.tokensIn,
	output: (req: Req) => req.output,
	reasoning: (req: Req) => req.reasoning,
	cacheRead: (req: Req) => req.cacheRead,
	cacheWrite: (req: Req) => req.cacheWrite,
} satisfies Record<keyof Profile, (req: Req) => number>;

export function emptyProfile(): Profile {
	return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

/** The mean of every measured field across these reqs. */
export function reqProfile(reqs: Req[]): Profile {
	const profile = emptyProfile();
	for (const [field, read] of Object.entries(FIELDS)) {
		profile[field as keyof Profile] = mean(reqs.map(read));
	}
	return profile;
}

/** Nearest-rank percentiles: the value at or below which that share of reqs fall. */
export function stats(values: number[]): Stats {
	if (values.length === 0) return { mean: 0, p10: 0, p50: 0, p90: 0, max: 0 };
	const sorted = [...values].sort((a, b) => a - b);
	const at = (p: number): number =>
		sorted[
			Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
		] ?? 0;
	return {
		mean: mean(values),
		p10: at(0.1),
		p50: at(0.5),
		p90: at(0.9),
		max: sorted[sorted.length - 1] ?? 0,
	};
}
