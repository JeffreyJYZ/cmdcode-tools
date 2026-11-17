// OpenDesign half of the panel: the rows that are not window meters.
//
// Split out of `od-rows.ts` at the repo's 200-line cap rather than trimming the
// comments that say why each figure is what it is. The block's assembly — the
// headline, the caveats, the three windows and the rule before the table — stays
// in `od-rows.ts`; the period, the wallet and the per-model table live here.
import { ROW_WIDTH } from "../constants/sidebar";
import type { OdCapView } from "./od-caps";
import { capOf, type OdWindowKey, type windowCaps } from "./od-window-caps";
import type { OdModel, OdUsage } from "./od";
import { clip, count, money, type SidebarRow, valueWidth } from "./rows";

/** The billing period's end and length, from the bounds `oduse` publishes. The
 *  month resets on the subscription anniversary, so its length is that span. */
export function monthPeriod(usage: OdUsage): { resetAt: number; durSecs: number } | undefined {
	const { periodStart, periodEndAt } = usage;
	if (typeof periodStart !== "number" || typeof periodEndAt !== "number") return undefined;
	const durSecs = Math.round((periodEndAt - periodStart) / 1000);
	if (durSecs <= 0) return undefined;
	return { resetAt: periodEndAt, durSecs };
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
export function walletRow(usage: OdUsage): SidebarRow {
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
 * the panel's three rows. Each row is divided by **that model's own** published
 * monthly allowance, because OpenDesign meters per model class: dividing the
 * whole period by the headline (Eco) cap is what made a Flash turn read as 1.5%
 * of $220 instead of 2.7% of $120.
 *
 * The multiplier is left out on purpose (the CLI has a MULT column; 37 columns
 * do not), and an unpriced model says so instead of printing a `$0` its turn did
 * not actually cost this machine.
 *
 * Empty below two models: a single row under a heading is noise, the same call
 * the Go panel makes.
 */
export function modelRows(
	usage: OdUsage,
	capFor: (model: OdModel) => number | undefined,
): SidebarRow[] {
	const ranked = [...usage.models.values()]
		.sort((a, b) => b.month.credits - a.month.credits)
		.slice(0, 3);
	if (ranked.length < 2) return [];
	const rows: SidebarRow[] = [["", "by model · this period", "muted"]];
	for (const entry of ranked) {
		let value = `${count(entry.month.requests)} req · unpriced`;
		if (entry.priced) {
			const cap = capFor(entry);
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

/** Credits each model spent in one window — what decides the cap set that window
 *  falls under. */
export function spendOf(
	usage: OdUsage,
	window: OdWindowKey,
): Array<{ id: string; credits: number }> {
	return [...usage.models.values()].map((entry) => ({
		id: entry.id,
		credits:
			window === "month"
				? entry.month.credits
				: window === "week"
					? entry.weekly.credits
					: entry.fiveHour.credits,
	}));
}

/** Whether any published set grants this window at all. A plan that publishes no
 *  5-hour cap gets no 5-hour row, and its caveat must not call that cut local. */
export function publishes(caps: OdCapView, window: OdWindowKey): boolean {
	const sets = [caps.legacy, caps.defaultCaps, ...caps.byModel.values()];
	return sets.some((set) => set && typeof capOf(set, window) === "number");
}

/** `of $120 · Flash caps (Eco $220)` — the denominator and the set that published
 *  it. The looser alternative rides along only when it fits, so the row clips at
 *  a word boundary rather than mid-number. */
export function capNote(chosen: NonNullable<ReturnType<typeof windowCaps>>, cap: number): string {
	const base = `of ${money(cap)} · ${chosen.label}`;
	const alt = chosen.alternatives[0];
	if (!alt) return base;
	const withAlt = `${base} (${alt})`;
	return withAlt.length <= valueWidth("") ? withAlt : base;
}

/** Whether the payload publishes any allowance at all. A legacy block, a
 *  `defaultCaps` or one per-model entry all count. */
export function hasCaps(caps: OdCapView): boolean {
	return !!caps.legacy || !!caps.defaultCaps || caps.byModel.size > 0;
}
