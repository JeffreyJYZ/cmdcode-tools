import type { Model } from "#~/model.ts";
import { type Rec, asRecord, positive } from "./row.ts";

/**
 * The declared priority order for `outputSpeed`, best first. AA publishes this
 * figure in more than one place and the places do not agree: on 2026-11-20 the
 * API carried 229.62 tok/s for DeepSeek V4.1 Flash while both page payloads
 * carried 160.63 for their build of it. Those are two different measurements,
 * never one series with a stale reading and a fresh one, so a merge must pick a
 * tier instead of taking the larger number.
 *
 * 1. `api` — `performance.median_output_tokens_per_second`: the field AA
 *    documents by that name on the data API, one named series at full precision,
 *    and the figure mpc has always shown for a keyed run.
 * 2. `page` — `outputSpeed` on a leaderboard row, `headline.outputSpeed` on a
 *    models-page row: the chart series both keyless payloads carry. Same shape,
 *    an aggregate AA re-bakes per effort variant, so it is a fallback only.
 * 3. `timescale` — `timescaleData.medianOutputSpeed`, the models page's older
 *    chart aggregate. Last, kept so a payload that still carries it is not blank.
 */
export type SpeedSource = "api" | "page" | "timescale";
export const SPEED_ORDER: readonly SpeedSource[] = ["api", "page", "timescale"];

/** Unknown provenance (a row stored by an older build) ranks below every tier. */
const WORST = SPEED_ORDER.length + 1;
const rankOf = (source: SpeedSource | null | undefined): number => {
	const at = source ? SPEED_ORDER.indexOf(source) : -1;
	return at < 0 ? WORST : at + 1;
};

/** Read `outputSpeed` in the declared order; `null` when no tier publishes one. */
export function readOutputSpeed(row: Rec): { value: number; source: SpeedSource } | null {
	const api = positive(asRecord(row.performance)?.median_output_tokens_per_second);
	if (api !== null) return { value: api, source: "api" };
	const page = positive(row.outputSpeed) ?? positive(asRecord(row.headline)?.outputSpeed);
	if (page !== null) return { value: page, source: "page" };
	const timescale = positive(asRecord(row.timescaleData)?.medianOutputSpeed);
	if (timescale !== null) return { value: timescale, source: "timescale" };
	return null;
}

/**
 * Keep the better measurement. A blank slot takes any figure; otherwise only a
 * better-ranked field replaces the incumbent, and an equal rank keeps it. Merging
 * a last-good catalogue *after* the live groups therefore replays a tier the
 * failed source alone published (its documented API median) while never
 * overwriting a live value from the same tier.
 */
export function takeSpeed(into: Model, from: Model): void {
	if (from.outputSpeed === null) return;
	if (
		into.outputSpeed !== null &&
		rankOf(from.outputSpeedSource) >= rankOf(into.outputSpeedSource)
	)
		return;
	into.outputSpeed = from.outputSpeed;
	into.outputSpeedSource = from.outputSpeedSource ?? null;
}
