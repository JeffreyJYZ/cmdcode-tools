import type { Profile } from "~/types.ts";
import type { RateEntry } from "./rates.ts";

/** One model's answer to "how many requests does my allowance buy me?". */
export interface Projection {
	entry: RateEntry;
	costPerReq: number;
	requestsPerMonth: number;
	requestsPerFiveHour: number | null;
	requestsPerWeek: number | null;
	/** Cache reads priced at the input rate because no cache rate is published. */
	cacheAtInput: boolean;
	/** Same, for cache writes. */
	writeAtInput: boolean;
}

/**
 * Price one request of the measured shape on one model.
 *
 * Reasoning tokens bill as output on every provider, so they join the output
 * term. A rate the model does not publish (cache write is null on most of the
 * catalogue) falls back to the input rate rather than to zero: not knowing a
 * price is no reason to assume it is free.
 */
export function project(entry: RateEntry, profile: Profile): Projection {
	const output = profile.output + profile.reasoning;
	const cacheRate = entry.cacheRead ?? entry.input;
	const writeRate = entry.cacheWrite ?? entry.input;
	const costPerReq =
		(profile.input * entry.input +
			output * entry.output +
			profile.cacheRead * cacheRate +
			profile.cacheWrite * writeRate) /
		1e6;

	const requestsPerMonth =
		costPerReq > 0
			? entry.allowance / costPerReq
			: Number.POSITIVE_INFINITY;

	return {
		entry,
		costPerReq,
		requestsPerMonth,
		requestsPerFiveHour:
			entry.ratio5h === null ? null : requestsPerMonth * entry.ratio5h,
		requestsPerWeek:
			entry.ratioWeek === null
				? null
				: requestsPerMonth * entry.ratioWeek,
		cacheAtInput: entry.cacheRead === null && profile.cacheRead > 0,
		writeAtInput: entry.cacheWrite === null && profile.cacheWrite > 0,
	};
}

export function projectAll(
	entries: RateEntry[],
	profile: Profile,
): Projection[] {
	return entries.map((entry) => project(entry, profile));
}
