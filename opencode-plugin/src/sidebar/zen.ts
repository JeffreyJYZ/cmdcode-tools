// OpenCode Go / Zen half of the panel (0.4.0).
//
// Usage comes from the `ocuse` CLI, the only local source for those providers:
// it reads opencode's own store and reports per-model window totals. Rates and
// benchmarks come from mpc's `oc` side, which the CommandCode panel already
// loads — one catalog, both products. Spawning lives in ./data with the other
// CLI calls; this module stays pure.
//
// Windows go through the same `rows.ts::windowRows` the CommandCode side uses,
// so `LIMIT EXCEEDED`, tone, `cap in …`, `elapsed` and `resets` have one
// implementation; only the rolling 5-hour/weekly windows stay without a reset
// countdown (see `zenWindow`).
import {
	FIVE_HOUR_SECS,
	GO_WINDOW_SHARE,
	WEEKLY_SECS,
} from "../constants/sidebar";
import {
	allowanceLabel,
	clip,
	count,
	localUsageRows,
	type ModelMeta,
	type ModelUsage,
	modelKey,
	money,
	rate,
	type SidebarRow,
	separator,
	valueWidth,
	windowRows,
} from "./rows";

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
	/**
	 * Billing period start, epoch ms: `periodStart` on current ocuse, or
	 * `periodStartAt` once it publishes the bounds (the same instants cmduse
	 * 0.7.2+ carries).
	 */
	periodStart?: number;
	/** Billing period end, epoch ms. Optional: older ocuse does not publish it
	 * and the Monthly row must then degrade to spend alone. */
	periodEndAt?: number;
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
		// Prefer the bounds once ocuse publishes them; fall back to `periodStart`,
		// which every build reports. Either is epoch ms.
		periodStart:
			typeof body.periodStartAt === "number"
				? body.periodStartAt
				: typeof body.periodStart === "number"
					? body.periodStart
					: undefined,
		periodEndAt:
			typeof body.periodEndAt === "number" ? body.periodEndAt : undefined,
		source: typeof body.source === "string" ? body.source : undefined,
		totals: {
			fiveHour: totals(top.fiveHour),
			weekly: totals(top.weekly),
			month: totals(top.month),
		},
		models,
	};
}

/**
 * The billing period's end and length, when ocuse publishes both bounds; absent
 * on builds before `periodEndAt`, where the Monthly row keeps to spend alone.
 */
function monthPeriod(
	usage: ZenUsage,
): { resetAt: number; durSecs: number } | undefined {
	const { periodStart, periodEndAt } = usage;
	if (typeof periodStart !== "number" || typeof periodEndAt !== "number")
		return undefined;
	const durSecs = Math.round((periodEndAt - periodStart) / 1000);
	if (durSecs <= 0) return undefined;
	return { resetAt: periodEndAt, durSecs };
}

/**
 * One window on the Go/Zen panel. With a cap it goes through the shared
 * `windowRows`, so the over-cap flag, tone, `cap in …`, `elapsed` and `resets`
 * all match the CommandCode panel; the window's request count rides on as the
 * `extra` continuation. Without a cap (Zen is pay-as-you-go, and a Go model may
 * publish no limit) the spend stands alone.
 *
 * `resetAt` is only set for Monthly, from the billing period's bounds: Go has no
 * usage API, so a rolling 5-hour/weekly window has no real reset epoch, and
 * ocuse would have to approximate one as "now + window" — a made-up countdown in
 * a usage panel is worse than none, so that refusal is deliberate.
 */
function zenWindow(
	label: string,
	spent: ZenTotals,
	limit: number | undefined,
	share: number,
	now: number,
	durSecs: number,
	resetAt?: number,
): SidebarRow[] {
	const cap =
		typeof limit === "number" && limit > 0 ? limit * share : undefined;
	if (cap === undefined) {
		// No allowance to divide: the spend (and its request count) stands alone.
		return [
			[
				label,
				`${money(spent.cost)} · ${count(spent.requests)} req`,
				"base",
			],
		];
	}
	return windowRows(
		label,
		{
			cap,
			used: spent.cost,
			resetAt,
			// Go has no usage API and therefore no `exceeded` flag: derive it, the
			// rule the account API applies — the window is over once its spend has
			// reached its cap.
			exceeded: spent.cost >= cap,
		},
		now,
		durSecs,
		spent.requests > 0 ? `${count(spent.requests)} req` : undefined,
	);
}

/** The OpenCode Go / Zen panel: period windows, a rule, then the active model.
 * Like `modelRows`, `fallbackName` (the session's own id) keeps the model block
 * — and the local `Usage (this model)` / `Session` figures, which need no network
 * — on screen when mpc's catalog is unreachable; only the catalog-derived rows
 * then drop out. */
export function zenRows(
	usage: ZenUsage | undefined,
	meta: ModelMeta | undefined,
	modelUsage?: ModelUsage,
	session?: ModelUsage,
	fallbackName?: string,
): SidebarRow[] {
	if (!usage) return [];
	const now = Date.now();
	const oc = meta?.oc;
	const rows: SidebarRow[] = [
		["Plan", `${oc?.plan ?? "Go"} · limits per model`, "base"],
	];
	// Go's limits are per model, so the windows read the active model's row
	// rather than the account totals: the caps belong to that model's allowance.
	const mine = meta ? usage.models.get(modelKey(meta.name)) : undefined;
	const limit = oc?.allowance ?? mine?.limit;
	// A window cap is one *model's* share, so it may only be paired with that
	// model's own spend. Without a per-model row ocuse's totals are account-wide,
	// and dividing them by one model's allowance would report the whole account
	// against a single cap; show the spend alone instead.
	const cap = mine ? limit : undefined;
	rows.push(
		...zenWindow(
			"5-hour",
			mine?.fiveHour ?? usage.totals.fiveHour,
			cap,
			GO_WINDOW_SHARE.fiveHour,
			now,
			FIVE_HOUR_SECS,
		),
	);
	rows.push(
		...zenWindow(
			"Weekly",
			mine?.weekly ?? usage.totals.weekly,
			cap,
			GO_WINDOW_SHARE.weekly,
			now,
			WEEKLY_SECS,
		),
	);
	// Monthly is a billing period, not a rolling window: its length and reset
	// come from the bounds ocuse publishes. "Monthly" matches the CommandCode
	// panel's label.
	const period = monthPeriod(usage);
	rows.push(
		...zenWindow(
			"Monthly",
			mine?.month ?? usage.totals.month,
			cap,
			GO_WINDOW_SHARE.month,
			now,
			period?.durSecs ?? 0,
			period?.resetAt,
		),
	);
	rows.push([
		"Period",
		`${count(usage.totals.month.requests)} requests · ${money(usage.totals.month.cost)}`,
		"base",
	]);
	rows.push(separator());
	const name = meta?.name ?? fallbackName;
	if (!name) return rows;
	rows.push(["Model", clip(name, valueWidth("Model")), "strong", true]);
	// The store-backed rows, exactly where `modelRows` puts them: this model's
	// requests, then this conversation's own totals.
	rows.push(...localUsageRows(modelUsage, session));
	if (!meta) return rows;
	if (typeof limit === "number") {
		// A free/unbounded model reads `∞`, not `$0/mo` (allowance 0 is the
		// convention for free, not an empty budget).
		rows.push(["Allowance", allowanceLabel(limit, oc?.free), "base"]);
	}
	if (oc?.rates) {
		const cache = [`cache read ${rate(oc.rates.cacheRead)}`];
		if (
			typeof oc.rates.cacheWrite === "number" &&
			oc.rates.cacheWrite > 0
		) {
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
	if (typeof oc?.tps === "number")
		rows.push(["Tok/s", String(oc.tps), "base"]);
	return rows;
}
