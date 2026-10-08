import type { MpcJson, MpcSide, ProviderId, RateEntry } from "./rates.ts";
import { numberOr } from "./sources.ts";

/**
 * The plan's window caps as a share of its monthly allowance. Taken from the
 * plan block when published, otherwise read back off a priced row — mpc has
 * already applied the provider's own rule there (20%/50% on OpenCode Go, 20%/50%
 * on GOAT and Pro, 30%/60% on Max and Go), so stating the rule again here is how
 * the two would drift apart.
 */
function ratiosOf(
	json: MpcJson,
): Map<string, { fiveHour: number; weekly: number }> {
	const ratios = new Map<string, { fiveHour: number; weekly: number }>();
	for (const [id, plan] of Object.entries(json.plans ?? {})) {
		const credits = numberOr(plan.credits);
		const fiveHour = numberOr(plan.fiveHour);
		const weekly = numberOr(plan.weekly);
		if (credits && credits > 0 && fiveHour !== null && weekly !== null) {
			ratios.set(id, {
				fiveHour: fiveHour / credits,
				weekly: weekly / credits,
			});
		}
	}
	for (const row of json.rows ?? []) {
		for (const side of [row.oc, row.cc]) {
			if (!side?.provider || ratios.has(side.provider)) continue;
			const month = numberOr(side.requestsPerMonth);
			const fiveHour = numberOr(side.requestsPerFiveHour);
			const weekly = numberOr(side.requestsPerWeek);
			if (!month || month <= 0 || fiveHour === null || weekly === null) {
				continue;
			}
			ratios.set(side.provider, {
				fiveHour: fiveHour / month,
				weekly: weekly / month,
			});
		}
	}
	return ratios;
}

function entryOf(
	key: string,
	model: string,
	provider: ProviderId,
	side: MpcSide,
	ratios: Map<string, { fiveHour: number; weekly: number }>,
): RateEntry | null {
	const pricing = side.pricing;
	const allowance = numberOr(side.allowance);
	// A model with no pricing is not a zero-cost model; it is unpriced.
	if (!pricing || allowance === null) return null;
	const ratio = ratios.get(provider);
	return {
		key,
		model,
		provider,
		plan: side.plan ?? "",
		input: numberOr(pricing.input) ?? 0,
		output: numberOr(pricing.output) ?? 0,
		cacheRead: numberOr(pricing.cacheRead),
		cacheWrite: numberOr(pricing.cacheWrite),
		allowance,
		ratio5h: ratio?.fiveHour ?? null,
		ratioWeek: ratio?.weekly ?? null,
		free: Boolean(side.free),
	};
}

/** Every model the two plans sell, as (model, provider) entries. */
export function entriesOf(json: MpcJson): RateEntry[] {
	const ratios = ratiosOf(json);
	const entries: RateEntry[] = [];
	for (const row of json.rows ?? []) {
		const key = row.key ?? "";
		const model = row.name ?? key;
		for (const [provider, side] of [
			["oc-go", row.oc],
			["cc", row.cc],
		] as const) {
			if (!side) continue;
			const entry = entryOf(key, model, provider, side, ratios);
			if (entry) entries.push(entry);
		}
	}
	return entries;
}
