// OpenCode Go / Zen half of the panel (0.4.0).
//
// Usage comes from the `ocuse` CLI, the only local source for those providers:
// it reads opencode's own store and reports per-model window totals. Rates and
// benchmarks come from mpc's `oc` side, which the CommandCode panel already
// loads — one catalog, both products. Spawning lives in ./data with the other
// CLI calls; this module stays pure.
//
// Deliberately no reset countdowns: Go has no usage API, so ocuse approximates
// a reset as "now + window" rather than reading one, and a made-up countdown in
// a usage panel is worse than none. Spend and caps are real, so those are shown.
import {
	clip,
	count,
	type ModelMeta,
	type ModelUsage,
	modelKey,
	money,
	pctTone,
	rate,
	type SidebarRow,
	separator,
	valueWidth,
} from "./rows";

/** Go's documented per-model window shares of the monthly allowance. */
export const GO_WINDOW_SHARE = {
	fiveHour: 0.2,
	weekly: 0.5,
	month: 1,
} as const;

export interface ZenTotals {
	requests: number;
	cost: number;
	tokens: number;
}

export interface ZenModel {
	id: string;
	provider: string;
	/** Monthly allowance the docs give this model, when they give one. */
	limit?: number;
	fiveHour: ZenTotals;
	weekly: ZenTotals;
	month: ZenTotals;
}

export interface ZenUsage {
	periodStart?: number;
	source?: string;
	totals: { fiveHour: ZenTotals; weekly: ZenTotals; month: ZenTotals };
	/** Keyed by canonical model key, the same normalisation the CC side matches on. */
	models: Map<string, ZenModel>;
}

function totals(value: unknown): ZenTotals {
	const v = (value ?? {}) as Record<string, unknown>;
	const num = (key: string) =>
		typeof v[key] === "number" ? (v[key] as number) : 0;
	return {
		requests: num("requests"),
		cost: num("cost"),
		tokens: num("tokens"),
	};
}

/** Parse `ocuse -1 --json`. Anything malformed reads as "no usage". */
export function parseZenJson(text: string): ZenUsage {
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		body = {};
	}
	const models = new Map<string, ZenModel>();
	for (const raw of (body.models ?? []) as Array<Record<string, unknown>>) {
		if (typeof raw.id !== "string") continue;
		models.set(modelKey(raw.id), {
			id: raw.id,
			provider: typeof raw.provider === "string" ? raw.provider : "",
			limit: typeof raw.limit === "number" ? raw.limit : undefined,
			fiveHour: totals(raw.fiveHour),
			weekly: totals(raw.weekly),
			month: totals(raw.month),
		});
	}
	const top = (body.totals ?? {}) as Record<string, unknown>;
	return {
		periodStart:
			typeof body.periodStart === "number" ? body.periodStart : undefined,
		source: typeof body.source === "string" ? body.source : undefined,
		totals: {
			fiveHour: totals(top.fiveHour),
			weekly: totals(top.weekly),
			month: totals(top.month),
		},
		models,
	};
}

/** One window: spend against its share of the model's allowance. */
function windowRows(
	label: string,
	spent: ZenTotals,
	limit: number | undefined,
	share: number,
): SidebarRow[] {
	if (typeof limit !== "number" || limit <= 0) {
		// Zen is pay-as-you-go: no allowance, so the spend stands alone.
		return [
			[label, `${money(spent.cost)} · ${count(spent.requests)} req`, "base"],
		];
	}
	const cap = limit * share;
	const pct = cap > 0 ? Math.round((spent.cost / cap) * 100) : 0;
	const rows: SidebarRow[] = [
		[label, `${money(spent.cost)}/${money(cap)} (${pct}%)`, pctTone(pct)],
	];
	if (spent.requests > 0)
		rows.push(["", `${count(spent.requests)} req`, "muted"]);
	return rows;
}

/** The OpenCode Go / Zen panel: period windows, a rule, then the active model. */
export function zenRows(
	usage: ZenUsage | undefined,
	meta: ModelMeta | undefined,
	session?: ModelUsage,
): SidebarRow[] {
	if (!usage) return [];
	const oc = meta?.oc;
	const rows: SidebarRow[] = [
		["Plan", `${oc?.plan ?? "Go"} · limits per model`, "base"],
	];
	// Go's limits are per model, so the windows read the active model's row
	// rather than the account totals: the caps belong to that model's allowance.
	const mine = meta ? usage.models.get(modelKey(meta.name)) : undefined;
	const limit = oc?.allowance ?? mine?.limit;
	rows.push(
		...windowRows(
			"5-hour",
			mine?.fiveHour ?? usage.totals.fiveHour,
			limit,
			GO_WINDOW_SHARE.fiveHour,
		),
	);
	rows.push(
		...windowRows(
			"Weekly",
			mine?.weekly ?? usage.totals.weekly,
			limit,
			GO_WINDOW_SHARE.weekly,
		),
	);
	rows.push(
		...windowRows(
			"Month",
			mine?.month ?? usage.totals.month,
			limit,
			GO_WINDOW_SHARE.month,
		),
	);
	rows.push([
		"Period",
		`${count(usage.totals.month.requests)} requests · ${money(usage.totals.month.cost)}`,
		"base",
	]);
	rows.push(separator());
	if (!meta) return rows;
	rows.push(["Model", clip(meta.name, valueWidth("Model")), "strong", true]);
	if (session) {
		const spent = session.cost > 0 ? ` · ${money(session.cost)}` : "";
		rows.push(["Session", `${count(session.requests)} req${spent}`, "base"]);
	}
	if (typeof limit === "number") {
		rows.push(["Allowance", `${money(limit)}/mo`, "base"]);
	}
	if (oc?.rates) {
		const cache = [`cache read ${rate(oc.rates.cacheRead)}`];
		if (typeof oc.rates.cacheWrite === "number" && oc.rates.cacheWrite > 0) {
			cache.push(`write ${rate(oc.rates.cacheWrite)}`);
		}
		rows.push([
			"Rates",
			`${rate(oc.rates.input)}/${rate(oc.rates.output)} in/out`,
			"base",
		]);
		rows.push(["", cache.join(" · "), "muted"]);
	}
	if (typeof oc?.ability === "number") {
		rows.push(["Intelligence", String(oc.ability), "base"]);
	}
	if (typeof oc?.tps === "number") rows.push(["Tok/s", String(oc.tps), "base"]);
	return rows;
}
