// OpenDesign half of the panel, data side.
//
// `oduse -1 --json` is the only source. It measures the Open Design desktop
// app's own store (the plan's credits and the app's wallet), which is the same
// account whose models an `open-design` session runs on — but far from the same
// data as opencode's message store: there are no cache tokens and no per-session
// dimension, so this family's section is account-wide. See `od-rows.ts` for the
// rows; they live beside this module because the repo caps a file at 200 lines
// rather than trimming the comments that say why each figure is what it is.
//
// Three things about this source are estimates and are labelled as such in the
// panel, because a reader who takes them for meters will misread the block: the
// store records no cache tokens, so every credit figure prices input and output
// only; the 5-hour and 7-day cuts are this machine's own (there is no per-window
// usage API); and the only server number is a wallet *balance*, never a meter.

/** One window (or the whole period) as `oduse` reports it: list-price dollars
 *  beside the plan's own unit. `credits = costUsd x the model's multiplier`, so
 *  the two are always the same turn counted twice. */
export interface OdTotals {
	requests: number;
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
	credits: number;
}

export interface OdModel {
	id: string;
	/** Credits per list-price dollar for this model. */
	multiplier: number;
	/** Whether the catalogue carries the model. An unpriced one spends no credits
	 *  that this machine can count, so its row says so instead of reading `$0`. */
	priced: boolean;
	month: OdTotals;
	fiveHour: OdTotals;
	weekly: OdTotals;
}

/** The app's local daemon wallet: a balance, not a window. */
export interface OdWallet {
	/** Absent when the daemon's answer carried no number: a wallet we cannot
	 *  read is not a `$0` balance. */
	balanceUsd?: number;
	source?: string;
	profile?: string;
	user?: string;
	/** The daemon answered from its own cache rather than upstream. */
	stale?: boolean;
}

/** The caps the plan publishes. `fiveHourUsd` is absent for every plan but Go:
 *  those plans do not throttle on a 5-hour basis at all, so the row must be
 *  absent rather than `$0` (a zero would read as an exhausted cap). */
export interface OdCaps {
	monthlyUsd?: number;
	weeklyUsd?: number;
	fiveHourUsd?: number;
	/** A second published allowance with no local meter (the store names models,
	 *  not which of them are the plan's own). */
	planModelCreditsUsd?: number;
}

export interface OdUsage {
	plan: string;
	caps: OdCaps;
	periodStart?: number;
	periodEndAt?: number;
	/** The month's start came from an inferred subscription anniversary. */
	periodInferred?: boolean;
	summary: OdTotals;
	totals: { month: OdTotals; fiveHour: OdTotals; weekly: OdTotals };
	/** Absent when the desktop app is closed, or with `--no-wallet`. */
	wallet?: OdWallet;
	/** Why `wallet` is absent, so "app closed" never reads as "$0 balance". */
	walletError?: string;
	models: Map<string, OdModel>;
}

const ZERO: OdTotals = { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, credits: 0 };

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A figure that may be honestly absent (`null` caps); anything malformed is
 *  absent too, so a bad payload cannot invent a cap. */
function optNum(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function totals(value: unknown): OdTotals {
	if (!value || typeof value !== "object") return { ...ZERO };
	const v = value as Record<string, unknown>;
	return {
		requests: num(v.requests),
		tokensIn: num(v.tokensIn),
		tokensOut: num(v.tokensOut),
		costUsd: num(v.costUsd),
		credits: num(v.credits),
	};
}

/** Parse `oduse -1 --json`. A malformed body reads as an empty `go` snapshot:
 *  never a fabricated plan, never a thrown error in the panel. */
export function parseOdJson(text: string): OdUsage {
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		body = {};
	}
	const models = new Map<string, OdModel>();
	for (const raw of (body.models ?? []) as Array<Record<string, unknown>>) {
		if (typeof raw.id !== "string") continue;
		models.set(raw.id, {
			id: raw.id,
			multiplier: num(raw.multiplier),
			priced: raw.priced !== false,
			month: totals(raw.month),
			fiveHour: totals(raw.fiveHour),
			weekly: totals(raw.weekly),
		});
	}
	const caps = (body.caps ?? {}) as Record<string, unknown>;
	const top = (body.totals ?? {}) as Record<string, unknown>;
	const wallet = body.wallet as Record<string, unknown> | null | undefined;
	return {
		plan: typeof body.plan === "string" ? body.plan : "go",
		caps: {
			monthlyUsd: optNum(caps.monthlyUsd),
			weeklyUsd: optNum(caps.weeklyUsd),
			// `null` from the CLI for a plan with no 5-hour cap; `optNum` keeps it
			// absent instead of turning it into a zero.
			fiveHourUsd: optNum(caps.fiveHourUsd),
			planModelCreditsUsd: optNum(caps.planModelCreditsUsd),
		},
		periodStart: optNum(body.periodStartAt) ?? optNum(body.periodStart),
		periodEndAt: optNum(body.periodEndAt),
		// Absent on a build that does not publish it; only `true` means inferred.
		periodInferred: body.periodInferred === true ? true : undefined,
		summary: totals(body.summary),
		totals: {
			month: totals(top.month),
			fiveHour: totals(top.fiveHour),
			weekly: totals(top.weekly),
		},
		wallet: wallet
			? {
					balanceUsd: optNum(wallet.balanceUsd),
					source: typeof wallet.source === "string" ? wallet.source : undefined,
					profile: typeof wallet.profile === "string" ? wallet.profile : undefined,
					user: typeof wallet.user === "string" ? wallet.user : undefined,
					stale: wallet.stale === true ? true : undefined,
				}
			: undefined,
		walletError:
			typeof body.walletError === "string" && body.walletError ? body.walletError : undefined,
		models,
	};
}
