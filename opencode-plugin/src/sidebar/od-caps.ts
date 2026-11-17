// OpenDesign caps: which allowance a window is measured against.
//
// OpenDesign publishes **model-dependent** allowances, so one plan can have
// several cap sets: Go is `$220/$55/$18` on DeepSeek V4.1 Flash Eco and
// `$120/$30/$10` on the original Flash. `oduse` is moving to publish them per
// model id with a `defaultCaps` fallback; an older binary publishes one flat
// `caps` block, which is only ever the plan's headline (Eco) allowance.
//
// This module owns both shapes and the rule that picks one, so the rows and the
// tests cannot disagree about which denominator a figure was divided by.

/** Which of the plan's three windows a figure belongs to. */
export type OdWindowKey = "month" | "week" | "fiveHour";

/** One published allowance, in list-price dollars. A window the plan does not
 *  publish is absent rather than `0`, which would read as an exhausted cap. */
export interface OdCapSet {
	monthlyUsd?: number;
	weeklyUsd?: number;
	fiveHourUsd?: number;
	/** The CLI's own name for the set (`Flash caps`); derived from the model id
	 *  when it names none. */
	label?: string;
}

/** The legacy single-set shape, keyed exactly as `oduse` printed it. */
export interface OdCaps extends OdCapSet {
	planModelCreditsUsd?: number;
}

/** The caps as the panel needs them: every published set, and the one the
 *  account's traffic actually falls under. */
export interface OdCapView {
	/** Absent on a per-model payload, present on the legacy one. */
	legacy?: OdCaps;
	/** Keyed by the model ids the store records. */
	byModel: Map<string, OdCapSet>;
	/** The plan's fallback for a model with no entry of its own. */
	defaultCaps?: OdCapSet;
	planModelCreditsUsd?: number;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function capSet(raw: unknown): OdCapSet | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const v = raw as Record<string, unknown>;
	const set: OdCapSet = {
		// The per-model shape spells the windows `month`/`week`/`fiveHour`; the
		// legacy one appends `Usd`. Both are accepted so a half-migrated payload
		// still divides by a real figure.
		monthlyUsd: num(v.monthlyUsd) ?? num(v.month),
		weeklyUsd: num(v.weeklyUsd) ?? num(v.week),
		fiveHourUsd: num(v.fiveHourUsd) ?? num(v.fiveHour),
		label: str(v.label),
	};
	if (
		set.monthlyUsd === undefined &&
		set.weeklyUsd === undefined &&
		set.fiveHourUsd === undefined
	) {
		return undefined;
	}
	return set;
}

/** One window's pick, as `oduse` reports it: the set it chose and, when an
 *  override won, the plan's own figure the same spend would have been charged
 *  against. */
export interface OdCapPick {
	label?: string;
	id?: string;
	/** The plan's published figure for this window, present only when the chosen
	 *  set is stricter than it. */
	looserUsd?: number;
}

/** A `caps` member in any of the three shapes seen so far — the legacy flat
 *  block, per-model entries beside `defaultCaps`, or `oduse`'s own
 *  `monthlyUsd` default plus a `capOverrides` list. Detected by shape, so none of
 *  them throws. */
export function parseCaps(raw: unknown): OdCapView {
	const body = (raw ?? {}) as Record<string, unknown>;
	// Some publishers nest the table one level deeper (`{caps: {caps: {...}}}`);
	// unwrap only when the inner object holds no window of its own, so a legacy
	// block with a stray `caps` field still parses as a block.
	const inner =
		body.caps && typeof body.caps === "object"
			? (body.caps as Record<string, unknown>)
			: undefined;
	const table = inner && !capSet(inner) ? { ...body, ...inner } : body;
	const byModel = new Map<string, OdCapSet>();
	const planModelCreditsUsd = num(table.planModelCreditsUsd) ?? num(table.planModelCredits);
	const defaultCaps = capSet(table.defaultCaps);
	if (defaultCaps) defaultCaps.label ??= "default caps";
	// `oduse` names the plan's own set beside its figures ("Eco") and lists the
	// models that get a different one; one override can cover several model ids.
	for (const raw of (table.capOverrides ?? []) as Array<Record<string, unknown>>) {
		const set = capSet(raw);
		if (!set) continue;
		set.label ??= str(raw.label) ?? "override";
		for (const model of (raw.models ?? []) as unknown[]) {
			if (typeof model === "string") byModel.set(model, set);
		}
	}

	let legacy: OdCaps | undefined;
	if (
		table.monthlyUsd !== undefined ||
		table.weeklyUsd !== undefined ||
		table.fiveHourUsd !== undefined
	) {
		const block = capSet(table);
		// The plan's own set is named on `oduse`'s payload ("Eco"), and that name is
		// what the panel has to print beside the denominator.
		if (block)
			legacy = {
				...block,
				label: block.label ?? str(table.defaultCapLabel),
				planModelCreditsUsd,
			};
	}
	for (const [key, value] of Object.entries(table)) {
		if (key === "planModelCreditsUsd" || key === "planModelCredits") continue;
		if (key === "defaultCaps" || key === "monthlyUsd" || key === "weeklyUsd") continue;
		if (key === "fiveHourUsd" || key === "month" || key === "week" || key === "fiveHour")
			continue;
		if (key === "label" || key === "caps" || key === "capOverrides") continue;
		if (key === "defaultCapLabel") continue;
		const set = capSet(value);
		if (set) byModel.set(key, set);
	}
	return { legacy, byModel, defaultCaps, planModelCreditsUsd };
}

/** The set for one model: its own entry, else the plan's fallback, else the
 *  legacy headline block (which is what an older `oduse` knows). */
export function capSetFor(caps: OdCapView, modelId?: string): OdCapSet | undefined {
	if (modelId) {
		const own = caps.byModel.get(modelId);
		if (own) return own;
	}
	return caps.defaultCaps ?? caps.legacy;
}

/** The JSON carries only the flat `caps` block: every figure is the plan's
 *  headline (Eco) allowance, not the one this model is metered against. */
export function capsAreHeadline(caps: OdCapView): boolean {
	return !!caps.legacy && caps.byModel.size === 0 && !caps.defaultCaps;
}

/** The per-window picks `oduse` computes itself. When present they are
 *  authoritative — the CLI decided which set bounds the window and said so — so
 *  the panel only formats them. Absent on a build that predates them. */
export function parsePicks(raw: unknown): Map<OdWindowKey, OdCapPick> {
	const body = (raw ?? {}) as Record<string, unknown>;
	const picks = new Map<OdWindowKey, OdCapPick>();
	const windows: Array<[string, OdWindowKey]> = [
		["monthly", "month"],
		["weekly", "week"],
		["fiveHour", "fiveHour"],
	];
	for (const [key, window] of windows) {
		const entry = body[key];
		if (!entry || typeof entry !== "object") continue;
		const v = entry as Record<string, unknown>;
		picks.set(window, {
			label: str(v.label),
			id: str(v.id),
			looserUsd: num(v.planDefaultMonthlyUsd),
		});
	}
	return picks;
}
