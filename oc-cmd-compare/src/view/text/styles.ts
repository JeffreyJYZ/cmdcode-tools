import { PROVIDER_COLOR, PROVIDER_TINT, SGR } from "#~/constants/view.ts";
import type { EntryMetrics, ProviderId } from "#~/types.ts";
import type { Row } from "#~/view/schema.ts";
import { fmtRate, shortProviderName } from "./format.ts";

/** Which side is cheaper per request on this row. */
export function cheaperSide(row: Row): "oc" | "cc" | "tie" | "none" {
	if (!row.oc || !row.cc) return "none";
	if (row.oc.payPerRequest === row.cc.payPerRequest) return "tie";
	return row.oc.payPerRequest < row.cc.payPerRequest ? "oc" : "cc";
}

export function winner(row: Row): string {
	// One-sided rows are not wins; name the side that carries the model.
	if (!row.oc) return `${shortProviderName("cc")} only`;
	if (!row.cc) return `${shortProviderName("oc-go")} only`;
	const side = cheaperSide(row);
	if (side === "tie") return "tie";
	return shortProviderName(side === "oc" ? "oc-go" : "cc");
}

export function bestIndex(row: Row): number {
	return Math.max(row.oc?.index ?? -1, row.cc?.index ?? -1, 0);
}

function valueScores(row: Row): number[] {
	return [row.oc?.valueIndex, row.cc?.valueIndex].filter(
		(value): value is number => typeof value === "number",
	);
}

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
export const freeOc = (r: Row): boolean => Boolean(r.oc?.free);
export const freeCc = (r: Row): boolean => Boolean(r.cc?.free);

function entryOf(row: Row, provider: ProviderId): EntryMetrics | undefined {
	return provider === "oc-go" ? row.oc : row.cc;
}

/**
 * A provider's whole column set is tinted with its identity colour, so the two
 * halves of the table read apart. An absent cell stays `dim` (dim = missing).
 */
export const tint =
	(provider: ProviderId) =>
	(row: Row): string | undefined =>
		entryOf(row, provider) ? PROVIDER_TINT[provider] : SGR.dim;

/** The tint, except a free model goes green (favourable). */
export const tintOrFree =
	(provider: ProviderId) =>
	(row: Row): string | undefined => {
		const entry = entryOf(row, provider);
		if (!entry) return SGR.dim;
		return entry.free ? SGR.green : PROVIDER_TINT[provider];
	};

/**
 * The cheaper side's cell in its provider's **bold** colour, the other side in
 * the quiet tint — so the win reads from brightness, and an OC win (cyan) never
 * looks like a CC win (magenta).
 */
export function sideStyle(side: "oc" | "cc") {
	const provider: ProviderId = side === "oc" ? "oc-go" : "cc";
	return (row: Row): string | undefined => {
		if (!entryOf(row, provider)) return SGR.dim;
		return cheaperSide(row) === side
			? PROVIDER_COLOR[provider]
			: PROVIDER_TINT[provider];
	};
}

/** WIN column: the winning side's own colour; a tie or a one-sided row plain. */
export const winnerStyle = (row: Row): string | undefined => {
	const side = cheaperSide(row);
	if (side === "tie" || side === "none") return undefined;
	return PROVIDER_COLOR[side === "oc" ? "oc-go" : "cc"];
};

let costCuts: [number, number] = [30, 60];
let valCuts: [number, number] = [40, 70];

/** Configure the green/yellow cut-offs for COST and VAL. */
export function setThresholds(
	cost: [number, number],
	val: [number, number],
): void {
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
	const ability = row.oc?.ability ?? row.cc?.ability ?? null;
	if (ability === null) return SGR.dim;
	if (!abilityRange || abilityRange[1] <= abilityRange[0]) return undefined;
	const score =
		(100 * (ability - abilityRange[0])) /
		(abilityRange[1] - abilityRange[0]);
	if (score >= valCuts[1]) return SGR.green;
	if (score >= valCuts[0]) return SGR.yellow;
	return SGR.red;
};
