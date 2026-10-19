// OpenCode Go / Zen half of the panel (0.4.0).
//
// Usage comes from the `ocuse` CLI: it reads opencode's own store for the
// per-model totals and, when the account has a Go key, OpenCode Go's usage
// endpoint for the three account meters — the shares opencode.ai/console shows.
// The meters win where both exist (they are the server's own numbers, with the
// server's window anchors); the store's per-model windows are the fallback.
// Rates and benchmarks come from mpc's `oc` side, which the CommandCode panel
// already loads — one catalog, both products. Spawning lives in ./data with the
// other CLI calls; this module stays pure.
//
// Windows go through the same `rows.ts::windowRows` the CommandCode side uses,
// so `LIMIT EXCEEDED`, tone, `cap in …`, `elapsed` and `resets` have one
// implementation. The rolling 5-hour/weekly windows get their reset from the
// oldest request still inside them (see `rollingReset`), so they carry the same
// continuation the CommandCode panel shows.
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

/** One of the account's own meters (`ocuse`'s `account` block). */
export interface ZenMeter {
	/** The server's own word; anything but "ok" reads as over the limit. */
	status: string;
	/** Percent of the window's limit already used — the console's number. */
	percent: number;
	/** Reset instant, epoch ms. */
	resetsAt?: number;
}

/** The account's three meters, under the endpoint's own names: `rolling` is the
 *  5-hour window. Only present when ocuse reached OpenCode Go's usage endpoint,
 *  and then these — not the per-model figures — are what opencode.ai/console
 *  shows, because only the server knows its own window anchors and price
 *  basis. */
export interface ZenAccount {
	rolling: ZenMeter;
	weekly: ZenMeter;
	monthly: ZenMeter;
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
	/** The account's own meters, when ocuse could ask for them. */
	account?: ZenAccount;
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

/** One meter out of `ocuse -1 --json`'s `account` block. Anything malformed
 *  reads as "inside the limit": a figure we cannot read must not raise a flag. */
function meter(value: unknown): ZenMeter {
	const v = (value ?? {}) as Record<string, unknown>;
	return {
		status: typeof v.status === "string" ? v.status : "ok",
		percent: typeof v.percent === "number" ? v.percent : 0,
		resetsAt: typeof v.resetsAt === "number" ? v.resetsAt : undefined,
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
		// Absent on an ocuse that could not reach the endpoint (no Go key, no
		// network, `--no-api`); the panel then falls back to the per-model rows.
		account: body.account
			? {
					rolling: meter(
						(body.account as Record<string, unknown>).rolling,
					),
					weekly: meter(
						(body.account as Record<string, unknown>).weekly,
					),
					monthly: meter(
						(body.account as Record<string, unknown>).monthly,
					),
				}
			: undefined,
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
 * The starts of the active model's rolling windows, epoch ms: the oldest request
 * still inside each one, from opencode's own store. The Go/Zen panel turns each
 * into a reset via `rollingReset`; absent when no such request exists.
 */
export interface ZenWindowStarts {
	fiveHour?: number;
	weekly?: number;
}

/**
 * A rolling window's reset, derived from the oldest request still inside it:
 * that request leaves the window at `oldest + durSecs`, which is an honest reset
 * epoch — unlike `now + durSecs`, a constant that would be noise in a usage
 * panel. Undefined when there is no oldest request (an empty window), so the row
 * keeps the same spend-only degrade it had before.
 */
export function rollingReset(
	startMs: number | undefined,
	durSecs: number,
): number | undefined {
	if (typeof startMs !== "number" || !Number.isFinite(startMs))
		return undefined;
	return startMs + durSecs * 1000;
}

/**
 * One window on the Go/Zen panel. With a cap it goes through the shared
 * `windowRows`, so the over-cap flag, tone, `cap in …`, `elapsed` and `resets`
 * all match the CommandCode panel; the window's request count rides on as the
 * `extra` continuation. Without a cap (Zen is pay-as-you-go, and a Go model may
 * publish no limit) the spend stands alone.
 *
 * `resetAt` is the billing period's end for Monthly, and the derived
 * `rollingReset` for 5-hour/Weekly; absent on an older ocuse (no period bounds)
 * or an empty window, where the row then keeps to spend (and its request count).
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
			// No server verdict on this path (the account's own `exceeded` flag
			// belongs to `zenMeterRows`): derive it, the rule the account API
			// applies — the window is over once its spend has reached its cap.
			exceeded: spent.cost >= cap,
		},
		now,
		durSecs,
		spent.requests > 0 ? `${count(spent.requests)} req` : undefined,
	);
}

/**
 * One of the account's own meters as a panel row: the active model's own money
 * against that window's share of its limit, with the server's percentage
 * labelled beside it, then the reset — through the shared `windowRows`, so the
 * tone, the `LIMIT EXCEEDED` flag, the `cap in …` pace line and `elapsed` all
 * behave exactly as they do on the CommandCode side.
 *
 * The account's percent leads the share because it is the figure the server
 * gates on and prints on its console; the money pair is this store's, and the
 * two need not divide to each other. Without a per-model row (no catalog, or no
 * ocuse row for this model) there is no money to pair it with, so the row falls
 * back to the share alone rather than dividing the account's spend by one
 * model's cap.
 */
function zenMeterRows(
	label: string,
	meter: ZenMeter,
	now: number,
	durSecs: number,
	local?: { spent: number; cap: number },
): SidebarRow[] {
	return windowRows(
		label,
		{
			cap: local?.cap ?? 100,
			used: local?.spent ?? meter.percent,
			resetAt: meter.resetsAt,
			sharePct: meter.percent,
			// The endpoint's own verdict, with the percent as the fallback the
			// account API's `exceeded` flag would give.
			exceeded: meter.percent >= 100 || meter.status !== "ok",
		},
		now,
		durSecs,
		undefined,
		(used, cap, share) =>
			local
				? `${money(used)}/${money(cap)} (${share.toFixed(1)}% of limit)`
				: `${share.toFixed(1)}% of limit`,
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
	windows?: ZenWindowStarts,
): SidebarRow[] {
	if (!usage) return [];
	const now = Date.now();
	const oc = meta?.oc;
	const rows: SidebarRow[] = [
		["Plan", `${oc?.plan ?? "Go"} · limits per model`, "base"],
	];
	// Go's limits are per model, so the windows read the active model's row
	// rather than the account totals: the caps belong to that model's allowance.
	// ocuse keys its per-model rows by model id, so the session's own id resolves
	// this row without mpc: the catalog supplies the display name, not the limit.
	// (mpc's name normalises to the same key, so it stays as the second try.)
	const mine =
		usage.models.get(modelKey(fallbackName ?? "")) ??
		(meta ? usage.models.get(modelKey(meta.name)) : undefined);
	const limit = oc?.allowance ?? mine?.limit;
	// A window cap is one *model's* share, so it may only be paired with that
	// model's own spend. Without a per-model row ocuse's totals are account-wide,
	// and dividing them by one model's allowance would report the whole account
	// against a single cap; the meter row then keeps the share alone.
	const cap = mine ? limit : undefined;
	const windowMoney = (
		spent: ZenTotals,
		share: number,
	): { spent: number; cap: number } | undefined =>
		mine && typeof limit === "number" && limit > 0
			? { spent: spent.cost, cap: limit * share }
			: undefined;
	// Monthly is a billing period, not a rolling window: its length and reset
	// come from the bounds ocuse publishes. "Monthly" matches the CommandCode
	// panel's label.
	const period = monthPeriod(usage);
	if (usage.account) {
		// The account's own meters, which is what opencode.ai/console shows and
		// what ocuse reads from Go's usage endpoint. They outrank the per-model
		// rows below because the server's window anchors (a 5-hour block with its
		// own reset, a Monday-anchored week, the billing anniversary) are not
		// reproducible from the store — the per-model windows are this machine's
		// own cuts, and the CC panel shows account windows in the same place.
		rows.push(
			...zenMeterRows(
				"5-hour",
				usage.account.rolling,
				now,
				FIVE_HOUR_SECS,
				mine
					? windowMoney(mine.fiveHour, GO_WINDOW_SHARE.fiveHour)
					: undefined,
			),
		);
		rows.push(
			...zenMeterRows(
				"Weekly",
				usage.account.weekly,
				now,
				WEEKLY_SECS,
				mine
					? windowMoney(mine.weekly, GO_WINDOW_SHARE.weekly)
					: undefined,
			),
		);
		rows.push(
			...zenMeterRows(
				"Monthly",
				usage.account.monthly,
				now,
				period?.durSecs ?? 0,
				mine
					? windowMoney(mine.month, GO_WINDOW_SHARE.month)
					: undefined,
			),
		);
	} else {
		// No endpoint answer (no Go key, no network, older ocuse): the store's own
		// rolling windows. A window's reset is derived from the oldest request
		// still inside it (the same store read that backs `Usage (this model)`), so
		// 5-hour and Weekly carry the elapsed share and the countdown the
		// CommandCode panel shows.
		rows.push(
			...zenWindow(
				"5-hour",
				mine?.fiveHour ?? usage.totals.fiveHour,
				cap,
				GO_WINDOW_SHARE.fiveHour,
				now,
				FIVE_HOUR_SECS,
				rollingReset(windows?.fiveHour, FIVE_HOUR_SECS),
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
				rollingReset(windows?.weekly, WEEKLY_SECS),
			),
		);
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
	}
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
	// The allowance outlives the catalog: ocuse publishes the model's own limit,
	// so it still renders when mpc is missing. Everything below is mpc-only.
	if (typeof limit === "number") {
		// A free/unbounded model reads `∞`, not `$0/mo` (allowance 0 is the
		// convention for free, not an empty budget).
		rows.push(["Allowance", allowanceLabel(limit, oc?.free), "base"]);
	}
	if (!meta) return rows;
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
