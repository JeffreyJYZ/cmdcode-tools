import { DEFAULT_SCORE } from "#~/constants/scoring.ts";
import type {
	CatalogEntry,
	EntryMetrics,
	PlanInfo,
	ProviderId,
	Workload,
} from "#~/types.ts";
import { lookupAbility, lookupTps } from "./ability.ts";
import { costPerRequest, windowRatios } from "./cost.ts";
import { assignIndex, assignValueIndex, type ScoreConfig } from "./score.ts";

export function buildMetrics(
	entries: CatalogEntry[],
	plans: Map<ProviderId, PlanInfo>,
	workloads: Record<ProviderId, Workload>,
	ability: Map<string, number> = new Map(),
	tps: Map<string, number> = new Map(),
	config: ScoreConfig = DEFAULT_SCORE,
): EntryMetrics[] {
	const metrics: EntryMetrics[] = entries.map((entry) => {
		const plan = plans.get(entry.provider);
		if (!plan)
			throw new Error(`no plan loaded for provider ${entry.provider}`);
		const workload = workloads[entry.provider];
		const cost = costPerRequest(entry.pricing, workload);
		const free = cost === 0;
		const requestsPerMonth = free
			? Number.POSITIVE_INFINITY
			: entry.allowance / cost;
		const ratios = windowRatios(plan, config.window);
		return {
			provider: entry.provider,
			plan: entry.plan,
			pricing: entry.pricing,
			allowance: entry.allowance,
			costPerRequest: cost,
			requestsPerMonth,
			requestsPerFiveHour: ratios.five * requestsPerMonth,
			requestsPerWeek: ratios.week * requestsPerMonth,
			payPerRequest: free ? 0 : (plan.price * cost) / entry.allowance,
			multiplier: plan.price > 0 ? entry.allowance / plan.price : 0,
			ability: lookupAbility(ability, entry.key, config.inheritSuffixes),
			tps: lookupTps(tps, entry.key, config.inheritSuffixes),
			deal: entry.deal,
			index: 0,
			valueIndex: null,
			free,
		};
	});
	assignIndex(metrics);
	assignValueIndex(metrics, config);
	return metrics;
}

export { lookupAbility, lookupTps } from "./ability.ts";
export { costPerRequest, windowRatios } from "./cost.ts";
export { buildRows } from "./rows.ts";
export { assignIndex, assignValueIndex } from "./score.ts";
