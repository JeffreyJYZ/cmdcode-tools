// OpenDesign caps: which allowance a window is measured against.
//
// OpenDesign publishes **model-dependent** allowances, so one plan can carry
// several cap sets: Go is `$220/$55/$18` on DeepSeek V4.1 Flash Eco and
// `$120/$30/$10` on the original Flash. `od-caps.ts` parses both payload
// shapes; this module turns them into the one denominator a window is drawn
// against, and names it so a bare cap is never read as the plan's headline.
import {
	capsAreHeadline,
	type OdCapPick,
	type OdCapSet,
	type OdCapView,
	type OdWindowKey,
} from "./od-caps";
import { money } from "./rows";

export type { OdWindowKey };

export function capOf(set: OdCapSet, window: OdWindowKey): number | undefined {
	if (window === "month") return set.monthlyUsd;
	if (window === "week") return set.weeklyUsd;
	return set.fiveHourUsd;
}

/** A model name for a cap set that publishes no `label`: `deepseek-v4.1-flash`
 *  reads `Flash caps`. The panel has 20-odd columns, so the last word is the one
 *  that carries the meaning. */
export function derivedLabel(modelId: string): string {
	const tail = modelId.split(/[-/]/).pop() ?? modelId;
	const word = tail.charAt(0).toUpperCase() + tail.slice(1);
	return `${word} caps`;
}

/**
 * Which allowance a window is measured against.
 *
 * A window holding two models is bounded by the **stricter** of their published
 * allowances — mixing them silently would report headroom neither model grants.
 * The chosen set is named, and a mixed window names the tighter alternative too,
 * so the figure is never read as the plan's headline.
 *
 * Returns `undefined` when no set publishes that window at all (a plan without
 * a 5-hour cap): the row is then absent rather than zero.
 */
export function windowCaps(
	caps: OdCapView,
	window: OdWindowKey,
	models: Array<{ id: string; credits: number }>,
): { set: OdCapSet; label: string; mixed: boolean; alternatives: string[] } | undefined {
	const spending = models.filter((entry) => entry.credits > 0);
	const candidates: Array<{ set: OdCapSet; label: string; id?: string }> = [];
	// One candidate per published *set*, not per model: two models sharing a
	// fallback must not read as two alternatives of the same figure.
	const seen = new Set<OdCapSet>();
	for (const entry of spending) {
		const set = caps.byModel.get(entry.id) ?? caps.defaultCaps ?? caps.legacy;
		if (!set || seen.has(set)) continue;
		seen.add(set);
		const id = caps.byModel.has(entry.id) ? entry.id : undefined;
		// A legacy-only payload has one block for everything: it is the plan's
		// headline (Eco) allowance, and calling it anything else would read as a
		// set the model was actually metered against.
		const derived = id
			? derivedLabel(id)
			: capsAreHeadline(caps)
				? "headline allowance"
				: "default caps";
		candidates.push({ set, label: set.label ?? derived, id });
	}
	if (candidates.length === 0) {
		// No turn in the window names a set, so the headline block still has to
		// draw the meter — an empty period is not a reason to hide the cap.
		const fallback = caps.defaultCaps ?? caps.legacy;
		// A plan that publishes no such window (no 5-hour cap outside Go) has no
		// denominator here either: the row is absent, never a zero.
		if (!fallback || typeof capOf(fallback, window) !== "number") return undefined;
		return {
			set: fallback,
			label: capsAreHeadline(caps)
				? "headline allowance"
				: (fallback.label ?? "default caps"),
			mixed: false,
			alternatives: [],
		};
	}
	const usable = candidates
		.filter((entry) => typeof capOf(entry.set, window) === "number")
		.sort((a, b) => (capOf(a.set, window) ?? 0) - (capOf(b.set, window) ?? 0));
	const chosen = usable[0];
	if (!chosen) return undefined;
	// Only a *different* allowance is worth naming: two models sharing one set
	// (or two sets publishing the same figure) are one denominator, not a choice.
	const chosenCap = capOf(chosen.set, window);
	const alternatives = usable
		.slice(1)
		.filter((entry) => capOf(entry.set, window) !== chosenCap)
		.map(
			(entry) => `${entry.label.replace(/ caps$/, "")} ${capText(capOf(entry.set, window))}`,
		);
	return {
		set: chosen.set,
		label: chosen.label,
		mixed: alternatives.length > 0,
		alternatives,
	};
}

function capText(value: number | undefined): string {
	return typeof value === "number" ? money(value) : "—";
}

/** The payload carries only the flat `caps` block, so every figure in it is the
 *  plan's headline (Eco) allowance rather than the set a given model is metered
 *  against. */

/**
 * A pick `oduse` computed is authoritative: the CLI already chose the set that
 * bounds the window across every model in it and published its name. The panel
 * formats that decision rather than second-guessing it, and keeps the plan's own
 * figure as the named alternative when the CLI says one was looser.
 */
export function applyPick(
	chosen: NonNullable<ReturnType<typeof windowCaps>>,
	pick: OdCapPick | undefined,
	/** The plan's own set, whose name is what a looser figure belongs to (Go
	 *  publishes `$220` as "Eco", not as the Flash set the pick chose). */
	planDefault?: { label?: string; monthlyUsd?: number },
	window: OdWindowKey = "month",
): NonNullable<ReturnType<typeof windowCaps>> {
	const alternatives = [...chosen.alternatives];
	const looser = typeof pick?.looserUsd === "number" ? pick.looserUsd : undefined;
	if (looser !== undefined && looser !== capOf(chosen.set, window)) {
		const name = (planDefault?.label ?? "plan").replace(/ caps$/, "");
		const alt = `${name} ${money(looser)}`;
		if (!alternatives.includes(alt)) alternatives.unshift(alt);
	}
	return {
		...chosen,
		label: pick?.label ?? chosen.label,
		mixed: alternatives.length > 0,
		alternatives,
	};
}
