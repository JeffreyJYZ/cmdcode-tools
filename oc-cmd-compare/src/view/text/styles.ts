import { SGR } from "#~/constants/view.ts";
import type { EntryMetrics } from "#~/types.ts";
import type { Row } from "#~/view/schema.ts";
import { fmtRate } from "./format.ts";
import { bestAbility, bestIndex, valueScores } from "./side.ts";

export const bestValue = (r: Row): string => {
	const scores = valueScores(r);
	return scores.length === 0 ? "—" : Math.max(...scores).toString();
};

export const bestCost = (r: Row): string => (100 - bestIndex(r)).toString();

export const pricingTriple = (m: EntryMetrics | undefined): string => {
	if (!m) return "—";
	const p = m.pricing;
	return `${fmtRate(p.input)}/${fmtRate(p.output)}/${fmtRate(p.cacheRead)}`;
};

export const ocRates = (r: Row): string => pricingTriple(r.oc);
export const ccRates = (r: Row): string => pricingTriple(r.cc);
export const odRates = (r: Row): string => pricingTriple(r.od);
export const freeOc = (r: Row): boolean => Boolean(r.oc?.free);
export const freeCc = (r: Row): boolean => Boolean(r.cc?.free);
export const freeOd = (r: Row): boolean => Boolean(r.od?.free);

let costCuts: [number, number] = [30, 60];
let valCuts: [number, number] = [40, 70];

/** Configure the green/yellow cut-offs for COST and VAL. */
export function setThresholds(cost: [number, number], val: [number, number]): void {
	costCuts = cost;
	valCuts = val;
}

/**
 * COST is inverted (0 = cheapest/best), so colour the other way round:
 * green = cheap, yellow/orange = mid, red = the pricier rows.
 */
export const costStyle = (r: Row): string | undefined => {
	const cost = 100 - bestIndex(r);
	if (cost <= costCuts[0]) return SGR.green;
	if (cost <= costCuts[1]) return SGR.yellow;
	return SGR.red;
};

export const valueStyle = (row: Row): string | undefined => {
	const scores = valueScores(row);
	if (scores.length === 0) return SGR.dim;
	const best = Math.max(...scores);
	if (best >= valCuts[1]) return SGR.green;
	if (best >= valCuts[0]) return SGR.yellow;
	return SGR.red;
};

export const enabledStyle = (value: number | null): string | undefined =>
	value === null ? SGR.dim : undefined;

let abilityRange: [number, number] | null = null;

/** The displayed ability range, so the column can rank like COST/VAL. */
export function setAbilityRange(min: number, max: number): void {
	abilityRange = [min, max];
}

/**
 * Ability is an absolute benchmark index with a narrow band, so an absolute
 * scale would be all-red; rank it across the table (min-max) and reuse the VAL
 * cut-offs, exactly as COST/VAL are coloured.
 */
export const abilityStyle = (row: Row): string | undefined => {
	const ability = bestAbility(row);
	if (ability === null) return SGR.dim;
	if (!abilityRange || abilityRange[1] <= abilityRange[0]) return undefined;
	const score = (100 * (ability - abilityRange[0])) / (abilityRange[1] - abilityRange[0]);
	if (score >= valCuts[1]) return SGR.green;
	if (score >= valCuts[0]) return SGR.yellow;
	return SGR.red;
};

/** Best ability score the row carries, whichever side supplies it. */
export { bestAbility, bestTps } from "./side.ts";
