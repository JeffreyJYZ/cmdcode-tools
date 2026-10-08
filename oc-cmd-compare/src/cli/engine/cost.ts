import { PER_MILLION } from "~/constants/scoring.ts";
import type { ModelPricing, PlanInfo, Workload } from "~/types.ts";

/**
 * USD of list-rate spend for a single request under the fixed workload.
 *
 * Reasoning bills at the output rate *on top of* output: the store's own
 * provider-priced rows reproduce exactly that way (a GLM-5.3 turn costing
 * 0.01242668 only matches when the 38 reasoning tokens are added to the 14
 * output ones at the 4.4 $/M output rate). A model that publishes no
 * cache-write rate is priced at its input rate rather than assumed free.
 */
export function costPerRequest(
	pricing: ModelPricing,
	workload: Workload,
): number {
	const output = workload.output + workload.reasoning;
	return (
		(workload.input * pricing.input +
			workload.cacheRead * pricing.cacheRead +
			output * pricing.output +
			workload.cacheWrite * (pricing.cacheWrite ?? pricing.input)) /
		PER_MILLION
	);
}

/**
 * Fraction of the monthly allowance each rolling window allows, per provider.
 * OpenCode Go fixes this at 20%/50%; CommandCode derives it from the plan's own
 * 5-hour / weekly dollar caps.
 */
export function windowRatios(
	plan: PlanInfo,
	override?: [number, number],
): { five: number; week: number } {
	if (override) return { five: override[0], week: override[1] };
	if (plan.provider === "oc-go") return { five: 0.2, week: 0.5 };
	if (plan.fiveHour !== null && plan.weekly !== null && plan.credits > 0) {
		return {
			five: plan.fiveHour / plan.credits,
			week: plan.weekly / plan.credits,
		};
	}
	return { five: 1, week: 1 };
}

export function minmax(values: number[]): number[] {
	if (values.length === 0) return [];
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (max === min) return values.map(() => 0.5);
	return values.map((v) => (v - min) / (max - min));
}

/**
 * Min-max over log10 values. Throughput and token prices span orders of
 * magnitude, so a single outlier would otherwise squash everyone else toward
 * one end of the scale. Non-positive values clamp to a floor.
 */
export function logMinmax(values: number[]): number[] {
	return minmax(values.map((v) => Math.log10(Math.max(v, 1e-6))));
}
