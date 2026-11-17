// OpenDesign half of the panel, rows side.
//
// The section belongs to the `open-design` provider: one family among the four,
// titled like the rest, and gated the same way — by its provider, plus the `od`
// pref that lets a user switch it off entirely (see `useRows`). It is the only
// family whose figures are account-wide rather than this session's, because
// `oduse` reads the desktop app's store, which records no session id.
//
// Everything below reuses the shared row vocabulary — `windowRows` for the
// meters, `money`/`count`/`clip` for the values — so `LIMIT EXCEEDED`, tone,
// `cap in …`, `elapsed` and `resets` behave exactly as in the other sections.
// Fields that are OpenDesign-only: `Wallet` (the app's daemon balance is not a
// window, so it can never be a meter row) and the `estimate` caveats, which have
// no counterpart because no other family prices from a store without cache
// tokens.
import { FIVE_HOUR_SECS, ROW_WIDTH, WEEKLY_SECS } from "../constants/sidebar";
import type { OdTotals, OdUsage } from "./od";
import { clip, count, money, type SidebarRow, separator, valueWidth, windowRows } from "./rows";

/** The billing period's end and length, from the bounds `oduse` publishes. The
 *  month resets on the subscription anniversary, so its length is that span. */
function monthPeriod(usage: OdUsage): { resetAt: number; durSecs: number } | undefined {
	const { periodStart, periodEndAt } = usage;
	if (typeof periodStart !== "number" || typeof periodEndAt !== "number") return undefined;
	const durSecs = Math.round((periodEndAt - periodStart) / 1000);
	if (durSecs <= 0) return undefined;
	return { resetAt: periodEndAt, durSecs };
}

/**
 * One window: this machine's credits against the cap the plan publishes, through
 * the shared `windowRows`. Unlike Go's, these caps are independent published
 * figures rather than shares of one monthly allowance, so nothing is multiplied.
 *
 * A window the plan does not publish produces **no row at all**, the rule
 * `oduse`'s own dashboard follows: plus/pro/max never throttle on a 5-hour
 * basis, and a row there would read as a meter the account does not have.
 */
function odWindow(
	label: string,
	used: OdTotals,
	cap: number | undefined,
	now: number,
	durSecs: number,
	resetAt?: number,
): SidebarRow[] {
	if (typeof cap !== "number" || cap <= 0) return [];
	// No server verdict exists for these windows, so the over-cap flag is
	// derived, the same rule the Go panel applies to its local cuts.
	return windowRows(
		label,
		{ cap, used: used.credits, resetAt, exceeded: used.credits >= cap },
		now,
		durSecs,
		`${count(used.requests)} req`,
	);
}

/**
 * The daemon's wallet. A balance answers nothing about a window, so it is its
 * own row and never a meter. A closed app is one dim line with the reason
 * `oduse` gave — never an error colour and never `$0`, which would read as an
 * empty wallet.
 *
 * The reason rides along only when it fits the value column: the CLI's is a
 * sentence with the endpoint appended ("daemon not running at http://…"), and a
 * reason cut mid-word reads as a defect. Too long, the row keeps the plain
 * verdict and `oduse` owns the why.
 *
 * `profile`/`user`/`source` are dropped: they identify the account rather than
 * measure it, and three more values do not fit a 37-column row.
 */
function walletRow(usage: OdUsage): SidebarRow {
	const wallet = usage.wallet;
	if (!wallet) {
		const width = valueWidth("Wallet");
		const withWhy = usage.walletError ? `no meter · ${usage.walletError}` : "no meter";
		return ["Wallet", withWhy.length <= width ? withWhy : "no meter", "muted"];
	}
	if (typeof wallet.balanceUsd !== "number") {
		// The daemon answered but the balance did not parse: still a no-meter line,
		// never "$0 balance".
		return ["Wallet", "no meter · unreadable balance", "muted"];
	}
	const bits = [`${money(wallet.balanceUsd)} balance`];
	if (wallet.stale) bits.push("cached");
	return ["Wallet", clip(bits.join(" · "), valueWidth("Wallet")), "base"];
}

/**
 * Per-model credits for the period, biggest first — the CLI's own table, cut to
 * the panel's three rows. The multiplier is left out on purpose (the CLI has a
 * MULT column; 37 columns do not), and an unpriced model says so instead of
 * printing a `$0` its turn did not actually cost this machine.
 *
 * Empty below two models: a single row under a heading is noise, the same call
 * the Go panel makes.
 */
function modelRows(usage: OdUsage): SidebarRow[] {
	const ranked = [...usage.models.values()]
		.sort((a, b) => b.month.credits - a.month.credits)
		.slice(0, 3);
	if (ranked.length < 2) return [];
	const cap = usage.caps.monthlyUsd;
	const rows: SidebarRow[] = [["", "by model · this period", "muted"]];
	for (const entry of ranked) {
		let value = `${count(entry.month.requests)} req · unpriced`;
		if (entry.priced) {
			value =
				typeof cap === "number" && cap > 0
					? `${money(entry.month.credits)}/${money(cap)} (${((entry.month.credits / cap) * 100).toFixed(1)}%)`
					: money(entry.month.credits);
		}
		// Label + 2 + value must fit; a floor keeps a freak value from turning the
		// clip width negative, which would return the whole id plus an ellipsis.
		const idWidth = Math.max(4, ROW_WIDTH - value.length - 2);
		rows.push([clip(entry.id, idWidth), value, "base"]);
	}
	return rows;
}

/**
 * The OpenDesign block: a headline naming the plan, the estimate caveats, the
 * window meters the plan publishes, the period, the wallet, then per-model
 * credits. Empty only when there is no snapshot at all — an empty period still
 * renders, because the caps are the point of the block.
 */
export function odRows(usage: OdUsage | undefined): SidebarRow[] {
	if (!usage) return [];
	const now = Date.now();
	const period = monthPeriod(usage);
	const rows: SidebarRow[] = [
		[
			"OpenDesign",
			clip(`${usage.plan} plan · estimate`, valueWidth("OpenDesign")),
			"base",
			true,
		],
	];
	// The caveats ride directly under the headline so no figure below is read as
	// a meter: credits are priced from list-price dollars and the multiplier, the
	// store carries no cache tokens, and the rolling cuts are local. Only the cuts
	// the plan actually publishes are named.
	const cuts = typeof usage.caps.fiveHourUsd === "number" ? "5h/7d" : "7d";
	rows.push(["", clip("credits = list-price $ x multiplier", valueWidth("")), "muted"]);
	rows.push(["", clip(`estimate · ${cuts} cut locally`, valueWidth("")), "muted"]);
	if (usage.periodInferred) {
		// `oduse` infers the month's start from the subscription anniversary when
		// nothing pins it; the Monthly reset below then rests on a guess, and that
		// belongs beside the other caveats rather than under a countdown.
		rows.push(["", "month start inferred", "muted"]);
	}
	rows.push(
		...odWindow("5-hour", usage.totals.fiveHour, usage.caps.fiveHourUsd, now, FIVE_HOUR_SECS),
	);
	rows.push(...odWindow("Weekly", usage.totals.weekly, usage.caps.weeklyUsd, now, WEEKLY_SECS));
	rows.push(
		...odWindow(
			"Monthly",
			usage.totals.month,
			usage.caps.monthlyUsd,
			now,
			period?.durSecs ?? 0,
			period?.resetAt,
		),
	);
	rows.push([
		"Period",
		clip(
			`${count(usage.summary.requests)} requests · ${money(usage.summary.credits)} credits`,
			valueWidth("Period"),
		),
		"base",
	]);
	if (usage.summary.requests === 0) {
		// The store exists but no turn landed in the period: say so, rather than
		// leaving zeroed windows and a reader wondering which figure broke.
		rows.push(["", "no completed turns in this period", "muted"]);
	}
	const planModel = usage.caps.planModelCreditsUsd;
	if (typeof planModel === "number" && planModel > 0) {
		rows.push([
			"",
			clip(`plan-model credits ${money(planModel)} · no meter`, valueWidth("")),
			"muted",
		]);
	}
	rows.push(walletRow(usage));
	// The per-model table is a second subject, so it gets a rule — but only when
	// there is a table: a lone model or none would otherwise leave a dangling
	// divider at the end of the block.
	const byModel = usage.summary.requests > 0 ? modelRows(usage) : [];
	if (byModel.length > 0) {
		rows.push(separator());
		rows.push(...byModel);
	}
	return rows;
}
