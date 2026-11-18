// Published OpenDesign token rates and multipliers. The values come from the
// monorepo's core/od.json, but mpc reads the generated copy inside src/ — npm
// ships only src/, so a static import reaching back into core/ broke every
// installed path. Regenerate with `bun scripts/extract-od-rates.ts`; the drift
// test pins the copy's values against the source of truth.
import { OD_PUBLISHED_ROWS } from "./od.generated.ts";
import type { ModelPricing } from "#~/types.ts";

/** A model's published price, or null when the row exists but has no rate. */
export interface OdRate {
	pricing: ModelPricing | null;
	/** The multiplier Open Design publishes per dollar of list-price usage. */
	multiplier: number;
}

const ROWS = new Map<string, OdRate>(
	OD_PUBLISHED_ROWS.map((m) => [
		m.id,
		{
			pricing:
				m.rateSource === "published"
					? {
							input: m.input,
							output: m.output,
							cacheRead: m.cacheRead,
							cacheWrite: m.cacheWrite ?? null,
						}
					: null,
			multiplier: m.multiplier,
		},
	]),
);

/**
 * Look up a model by its gateway wire id. undefined = no row for that id at all
 * (a caller may fall back to another catalog and flag it); `pricing: null` =
 * the row exists but publishes no rate, which must stay unpriced.
 */
export function odRate(id: string): OdRate | undefined {
	return ROWS.get(id);
}
