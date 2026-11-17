import { PROVIDER_COLOR, PROVIDER_TINT, SGR } from "#~/constants/view.ts";
import type { EntryMetrics, SideId } from "#~/types.ts";
import type { Row } from "#~/view/schema.ts";

/** A side as the WIN column and the colour helpers spell it. */
export type SideShort = "oc" | "cc" | "od";

const SIDE_OF: Record<SideShort, SideId> = { oc: "oc-go", cc: "cc", od: "od" };
const SHORT: Record<SideShort, string> = { oc: "OC", cc: "CC", od: "OD" };

export function entryOf(row: Row, provider: SideId): EntryMetrics | undefined {
	if (provider === "oc-go") return row.oc;
	if (provider === "od") return row.od;
	return row.cc;
}

/** The sides this row actually carries, in table order. */
export function presentSides(row: Row): { side: SideShort; entry: EntryMetrics }[] {
	const sides: { side: SideShort; entry: EntryMetrics }[] = [];
	if (row.oc) sides.push({ side: "oc", entry: row.oc });
	if (row.cc) sides.push({ side: "cc", entry: row.cc });
	if (row.od) sides.push({ side: "od", entry: row.od });
	return sides;
}

/**
 * Which side is cheaper per request. More than one cheapest side reads as a
 * tie: with three sides a two-way tie for cheapest is still not one winner.
 */
export function cheaperSide(row: Row): SideShort | "tie" | "none" {
	const present = presentSides(row);
	if (present.length < 2) return "none";
	const cheapest = Math.min(...present.map((p) => p.entry.payPerRequest));
	const wins = present.filter((p) => p.entry.payPerRequest === cheapest);
	if (wins.length !== 1) return "tie";
	return wins[0]?.side ?? "tie";
}

export function winner(row: Row): string {
	const present = presentSides(row);
	const only = present[0];
	// One-sided rows are not wins; name the side that carries the model.
	if (present.length === 1 && only) return `${SHORT[only.side]} only`;
	if (present.length === 0) return "—";
	const side = cheaperSide(row);
	if (side === "none") return "—";
	if (side === "tie") return "tie";
	return SHORT[side];
}

/**
 * A provider's whole column set is tinted with its identity colour, so the
 * halves of the table read apart. An absent cell stays `dim` (dim = missing).
 */
export const tint =
	(provider: SideId) =>
	(row: Row): string | undefined =>
		entryOf(row, provider) ? PROVIDER_TINT[provider] : SGR.dim;

/** The tint, except a free model goes green (favourable). */
export const tintOrFree =
	(provider: SideId) =>
	(row: Row): string | undefined => {
		const entry = entryOf(row, provider);
		if (!entry) return SGR.dim;
		return entry.free ? SGR.green : PROVIDER_TINT[provider];
	};

/**
 * The cheaper side's cell in its provider's **bold** colour, the other sides in
 * the quiet tint — so the win reads from brightness, and an OC win (cyan) never
 * looks like a CC (magenta) or OD (blue) one.
 */
export function sideStyle(side: SideShort) {
	const provider = SIDE_OF[side];
	return (row: Row): string | undefined => {
		if (!entryOf(row, provider)) return SGR.dim;
		return cheaperSide(row) === side ? PROVIDER_COLOR[provider] : PROVIDER_TINT[provider];
	};
}

/** WIN column: the winning side's own colour; a tie or a one-sided row plain. */
export const winnerStyle = (row: Row): string | undefined => {
	const side = cheaperSide(row);
	if (side === "tie" || side === "none") return undefined;
	return PROVIDER_COLOR[SIDE_OF[side]];
};

/** Best (lowest) COST index across the sides the row carries. */
export function bestIndex(row: Row): number {
	return Math.max(...presentSides(row).map((p) => p.entry.index), 0);
}

export function valueScores(row: Row): number[] {
	return presentSides(row)
		.map((p) => p.entry.valueIndex)
		.filter((value): value is number => typeof value === "number");
}

/** Best ability score the row carries, whichever side supplies it. */
export function bestAbility(row: Row): number | null {
	const scores = presentSides(row)
		.map((p) => p.entry.ability)
		.filter((value): value is number => typeof value === "number");
	return scores.length === 0 ? null : Math.max(...scores);
}

/** Best measured throughput the row carries. */
export function bestTps(row: Row): number | null {
	const scores = presentSides(row)
		.map((p) => p.entry.tps)
		.filter((value): value is number => typeof value === "number");
	return scores.length === 0 ? null : Math.max(...scores);
}
