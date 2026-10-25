// Volcengine ARK half of the panel.
//
// `arkuse -1 --json` is the only source: the control plane's own 5-hour /
// daily / weekly / monthly meters (what the console reports), this store's AFP
// per model, and the period bounds. ARK meters in AFP, not money, so the rows
// carry AFP and only the period line adds the yuan equivalent — one figure per
// subject, the same rule the Go/Zen block follows.
//
// Windows go through the shared `windowRows`, so the tone, `LIMIT EXCEEDED`,
// `cap in …`, `elapsed` and `resets` behaviour is one implementation across the
// three families. Without an account answer the rows fall back to this store's
// AFP alone, labelled as an estimate.
import { FIVE_HOUR_SECS, ROW_WIDTH, WEEKLY_SECS } from "../constants/sidebar";
import {
	actionableAccountError,
	clip,
	count,
	money,
	type SidebarRow,
	separator,
	valueWidth,
	windowRows,
} from "./rows";

export interface ArkTotals {
	afp: number;
	requests: number;
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
}

/** One of the plan's own meters (`arkuse`'s `account` block). Every field is
 *  optional-ish by parsing: a malformed meter must not raise a cap flag. */
export interface ArkMeter {
	status: string;
	percent: number;
	used: number;
	total: number;
	resetAt?: number;
}

export interface ArkModel {
	id: string;
	coef: number;
	fiveHour: ArkTotals;
	weekly: ArkTotals;
	month: ArkTotals;
}

/** This store's own view of one window (`arkuse`'s `windows` block): AFP against
 *  the plan's published quota, the percentage that yields, and the boundary the
 *  row counts down to. Present even when no meter answered, which is what keeps
 *  a panel row from degrading to AFP alone. */
export interface ArkWindow {
	quota?: number;
	percent?: number;
	resetAt?: number;
}

export interface ArkUsage {
	plan: string;
	profile?: string;
	periodStart?: number;
	periodEndAt?: number;
	summary: ArkTotals & { yuan?: number };
	fiveHour: ArkTotals;
	weekly: ArkTotals;
	month: ArkTotals;
	daily?: ArkTotals;
	windows?: {
		fiveHour?: ArkWindow;
		weekly?: ArkWindow;
		monthly?: ArkWindow;
	};
	account?: {
		fiveHour: ArkMeter;
		daily?: ArkMeter;
		weekly: ArkMeter;
		monthly: ArkMeter;
	};
	accountError?: string;
	afpPerRequest?: number;
	reconciledPct?: number;
	/** Keyed by model id, the same key the session's model id uses. */
	models: Map<string, ArkModel>;
}

function totals(value: unknown): ArkTotals {
	const v = (value ?? {}) as Record<string, unknown>;
	const num = (key: string) => (typeof v[key] === "number" ? v[key] : 0);
	return {
		afp: num("afp"),
		requests: num("requests"),
		tokensIn: num("tokensIn"),
		tokensOut: num("tokensOut"),
		cacheRead: num("cacheRead"),
	};
}

function meter(value: unknown): ArkMeter {
	const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
	return {
		status: typeof v.status === "string" ? v.status : "ok",
		percent: typeof v.percent === "number" ? v.percent : 0,
		used: typeof v.used === "number" ? v.used : 0,
		total: typeof v.total === "number" ? v.total : 0,
		resetAt: typeof v.resetAt === "number" ? v.resetAt : undefined,
	};
}

/** One of this store's own windows (`arkuse`'s `windows` block). */
function storeWindow(value: unknown): ArkWindow | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	return {
		quota: typeof v.quota === "number" ? v.quota : undefined,
		percent: typeof v.percent === "number" ? v.percent : undefined,
		resetAt: typeof v.resetAt === "number" ? v.resetAt : undefined,
	};
}

/** Parse `arkuse -1 --json`. A malformed body reads as an empty snapshot, never
 *  as a fabricated plan. */
export function parseArkJson(text: string): ArkUsage {
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		body = {};
	}
	const account = (body.account ?? {}) as Record<string, unknown>;
	const models = new Map<string, ArkModel>();
	const rawModels = (body.models ?? {}) as Record<string, unknown>;
	for (const [id, raw] of Object.entries(rawModels)) {
		const m = (raw ?? {}) as Record<string, unknown>;
		models.set(id, {
			id,
			coef: typeof m.coef === "number" ? m.coef : 0,
			fiveHour: totals(m.fiveHour),
			weekly: totals(m.weekly),
			month: totals(m.month),
		});
	}
	const summary = (body.summary ?? {}) as Record<string, unknown>;
	const windows = (body.windows ?? {}) as Record<string, unknown>;
	return {
		plan: typeof body.plan === "string" ? body.plan : "medium",
		profile: typeof body.profile === "string" ? body.profile : undefined,
		periodStart: typeof body.periodStart === "number" ? body.periodStart : undefined,
		periodEndAt: typeof body.periodEndAt === "number" ? body.periodEndAt : undefined,
		summary: {
			...totals(summary),
			yuan: typeof summary.yuan === "number" ? summary.yuan : undefined,
		},
		fiveHour: totals(body.fiveHour),
		weekly: totals(body.weekly),
		month: totals(body.monthly),
		daily: body.daily ? totals(body.daily) : undefined,
		windows: body.windows
			? {
					fiveHour: storeWindow(windows.fiveHour),
					weekly: storeWindow(windows.weekly),
					monthly: storeWindow(windows.monthly),
				}
			: undefined,
		account: body.account
			? {
					fiveHour: meter(account.fiveHour),
					daily: account.daily ? meter(account.daily) : undefined,
					weekly: meter(account.weekly),
					monthly: meter(account.monthly),
				}
			: undefined,
		accountError:
			typeof body.accountError === "string" && body.accountError
				? body.accountError
				: undefined,
		afpPerRequest: typeof body.afpPerRequest === "number" ? body.afpPerRequest : undefined,
		reconciledPct: typeof body.reconciledPct === "number" ? body.reconciledPct : undefined,
		models,
	};
}

/** The billing period's length in seconds and its reset instant, from the
 *  bounds `arkuse` publishes. The monthly reset is the anniversary, so its
 *  length is its start-to-end span rather than a fixed 30 days. */
function monthPeriod(usage: ArkUsage): { resetAt: number; durSecs: number } | undefined {
	const { periodStart, periodEndAt } = usage;
	if (typeof periodStart !== "number" || typeof periodEndAt !== "number") return undefined;
	const durSecs = Math.round((periodEndAt - periodStart) / 1000);
	if (durSecs <= 0) return undefined;
	return { resetAt: periodEndAt, durSecs };
}

/** `1,234 AFP` — AFP is a count, not money, so no decimals. */
function afp(value: number): string {
	return `${grouped(Math.round(value))} AFP`;
}

/** Thousands-grouped digits: the CLI's own AFP form, readable at a glance. */
function grouped(value: number): string {
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Short AFP for the meter pair, where a label leaves ~33 columns: `4.3K`,
 *  `100K`, `10K` — one decimal, trimmed when it is zero. The pair has to fit
 *  beside the label, the share and the local figure. */
function brief(value: number): string {
	const rounded = Math.round(value);
	const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");
	if (rounded >= 1_000_000) return `${trim(rounded / 1_000_000)}M`;
	if (rounded >= 1_000) return `${trim(rounded / 1_000)}K`;
	return String(rounded);
}

/**
 * One of the plan's meters as a panel row: this window's used / total pair, the
 * server's own share, this store's AFP for the same window labelled `local`,
 * the reset countdown and the pace. `sharePct` keeps the console's figure the
 * one that gates; the AFP pair beside it is the plan's own quota, which ARK
 * publishes (unlike Go), so the division is honest.
 */
function meterRows(
	label: string,
	meter: ArkMeter,
	local: ArkTotals,
	now: number,
	durSecs: number,
): SidebarRow[] {
	const pct = meter.percent;
	const pctText = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
	// ARK's own quota is real, so the pair is used/total with the server's share.
	// The local AFP repeats the same window from this store, on its own
	// continuation line: the label plus the share already fill a 37-column row,
	// and a second figure on it read as part of the division.
	return windowRows(
		label,
		{
			cap: meter.total > 0 ? meter.total : undefined,
			used: meter.used,
			resetAt: meter.resetAt,
			sharePct: pct,
			exceeded: pct >= 100 || meter.status !== "ok",
		},
		now,
		durSecs,
		`${afp(local.afp)} local${local.requests > 0 ? ` · ${count(local.requests)} req` : ""}`,
		(used, cap) => `${brief(used)}/${brief(cap)} (${pctText}%)`,
	);
}

/** The store's own view of one window: `used / quota` against the plan's
 *  published split, the percentage that division yields, its reset and pace.
 *  Without a quota (an older `arkuse`) it degrades to AFP alone rather than
 *  inventing a denominator. */
function localRows(
	label: string,
	totals: ArkTotals,
	window: ArkWindow | undefined,
	now: number,
	durSecs: number,
): SidebarRow[] {
	const quota = window?.quota;
	const percent = window?.percent;
	if (typeof quota !== "number" || quota <= 0 || typeof percent !== "number") {
		const detail = totals.requests > 0 ? ` · ${count(totals.requests)} req` : "";
		return [[label, `${afp(totals.afp)}${detail}`, "base"]];
	}
	const pctText = percent.toFixed(1);
	return windowRows(
		label,
		{
			cap: quota,
			used: totals.afp,
			resetAt: window?.resetAt,
			sharePct: percent,
			exceeded: percent >= 100,
		},
		now,
		durSecs,
		`${count(totals.requests)} req`,
		(used, cap) => `${brief(used)}/${brief(cap)} (${pctText}% est.)`,
	);
}

/**
 * The ARK panel: plan, the window meters, a rule, then the active model's own
 * AFP for the period. `fallbackName` is the session's model id, which is the
 * key `arkuse` uses, so the model block renders even when nothing else knows the
 * name.
 */
export function arkRows(usage: ArkUsage | undefined, fallbackName?: string): SidebarRow[] {
	if (!usage) return [];
	const now = Date.now();
	const rows: SidebarRow[] = [
		[
			"Plan",
			clip(
				`${usage.plan} · AFP plan${usage.profile ? ` · ${usage.profile}` : ""}`,
				valueWidth("Plan"),
			),
			"base",
			true,
		],
	];
	// The reason the plan's own numbers are missing belongs here, not buried
	// below: an expired profile means every window below is this store's guess.
	// Transport faults are excluded — they heal on the next poll, and printing
	// them made the row flicker.
	if (usage.accountError && actionableAccountError(usage.accountError)) {
		rows.push(["", clip(`usage API: ${usage.accountError}`, valueWidth("")), "warn"]);
	}
	const period = monthPeriod(usage);
	if (usage.account) {
		const account = usage.account;
		rows.push(...meterRows("5-hour", account.fiveHour, usage.fiveHour, now, FIVE_HOUR_SECS));
		if (account.daily) {
			rows.push(
				...meterRows("Daily", account.daily, usage.daily ?? usage.month, now, 86_400),
			);
		}
		rows.push(...meterRows("Weekly", account.weekly, usage.weekly, now, WEEKLY_SECS));
		rows.push(...meterRows("Monthly", account.monthly, usage.month, now, period?.durSecs ?? 0));
	} else {
		const windows = usage.windows;
		rows.push(...localRows("5-hour", usage.fiveHour, windows?.fiveHour, now, FIVE_HOUR_SECS));
		rows.push(...localRows("Weekly", usage.weekly, windows?.weekly, now, WEEKLY_SECS));
		rows.push(
			...localRows("Monthly", usage.month, windows?.monthly, now, period?.durSecs ?? 0),
		);
	}
	const yuan = typeof usage.summary.yuan === "number" ? ` (${money(usage.summary.yuan)})` : "";
	rows.push([
		"Period",
		clip(
			`${count(usage.summary.requests)} requests · ${afp(usage.summary.afp)}${yuan}`,
			valueWidth("Period"),
		),
		"base",
	]);
	if (typeof usage.afpPerRequest === "number" && usage.afpPerRequest > 0) {
		const drift =
			typeof usage.reconciledPct === "number"
				? ` · ${usage.reconciledPct >= 0 ? "+" : ""}${usage.reconciledPct.toFixed(1)}% vs meter`
				: "";
		rows.push([
			"",
			clip(`${usage.afpPerRequest.toFixed(0)} AFP/request${drift}`, valueWidth("")),
			"muted",
		]);
	}
	rows.push(separator());
	if (!fallbackName) return rows;
	const model = usage.models.get(fallbackName);
	rows.push(["Model", clip(fallbackName, valueWidth("Model")), "strong", true]);
	rows.push([
		"AFP (this model)",
		model
			? clip(
					`${afp(model.month.afp)} · ${count(model.month.requests)} req`,
					valueWidth("AFP (this model)"),
				)
			: "no usage in this period",
		"base",
	]);
	if (model && usage.summary.afp > 0) {
		const share = (model.month.afp / usage.summary.afp) * 100;
		rows.push([
			"",
			clip(
				`${share.toFixed(1)}% of the period · coef ${model.coef.toFixed(2)}`,
				Math.min(ROW_WIDTH, valueWidth("")),
			),
			"muted",
		]);
	}
	return rows;
}
