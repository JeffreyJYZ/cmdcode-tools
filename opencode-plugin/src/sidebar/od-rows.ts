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
// tokens. The caps themselves are model-dependent, which `od-caps.ts` owns.
import { FIVE_HOUR_SECS, WEEKLY_SECS } from "../constants/sidebar";
import type { OdCapPick, OdCapView } from "./od-caps";
import { applyPick, capOf, type OdWindowKey, windowCaps } from "./od-window-caps";
import type { OdTotals, OdUsage } from "./od";
import {
	capNote,
	hasCaps,
	monthPeriod,
	modelRows,
	publishes,
	spendOf,
	walletRow,
} from "./od-rows-parts";
import { clip, count, money, type SidebarRow, separator, valueWidth, windowRows } from "./rows";

/**
 * One window: this machine's credits against the cap the plan publishes for the
 * models that spent it, through the shared `windowRows`. Unlike Go's, these caps
 * are independent published figures rather than shares of one monthly allowance,
 * so nothing is multiplied.
 *
 * The cap is **model-dependent** — Go allows `$220/month` on Eco and `$120` on
 * the original Flash — so `windowCaps` picks the stricter set for the models
 * actually in the window, and a continuation row names it. A bare cap there
 * would read as headroom the model used does not grant.
 *
 * A window the plan does not publish produces **no row at all**, the rule
 * `oduse`'s own dashboard follows: plus/pro/max never throttle on a 5-hour
 * basis, and a row there would read as a meter the account does not have.
 */
function odWindow(
	label: string,
	used: OdTotals,
	caps: OdCapView,
	window: OdWindowKey,
	spend: Array<{ id: string; credits: number }>,
	pick: OdCapPick | undefined,
	now: number,
	durSecs: number,
	resetAt?: number,
): SidebarRow[] {
	const picked = windowCaps(caps, window, spend);
	if (!picked) return [];
	// `oduse` already decided which set bounds this window across every model in
	// it; when the payload carries that decision the panel formats it rather than
	// re-deriving one that could disagree with the CLI's own frame.
	const chosen = applyPick(picked, pick, caps.legacy, window);
	const cap = capOf(chosen.set, window);
	if (typeof cap !== "number" || cap <= 0) return [];
	// No server verdict exists for these windows, so the over-cap flag is
	// derived, the same rule the Go panel applies to its local cuts.
	const rows = windowRows(
		label,
		{ cap, used: used.credits, resetAt, exceeded: used.credits >= cap },
		now,
		durSecs,
		`${count(used.requests)} req`,
	);
	rows.push(["", clip(capNote(chosen, cap), valueWidth("")), "muted"]);
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
	const caps = usage.caps;
	// The label is `Plan`, like the other three sections' headline row. Labelling
	// it with the family name printed the section's own title twice — the panel
	// draws the title above the rows, so the block opened with a bold
	// "OpenDesign" over "OpenDesign: go plan · estimate".
	const rows: SidebarRow[] = [
		["Plan", clip(`${usage.plan} plan · estimate`, valueWidth("Plan")), "base", true],
	];
	// The caveats ride directly under the headline so no figure below is read as
	// a meter: credits are priced from list-price dollars and the multiplier, the
	// store carries no cache tokens, and the rolling cuts are local. Only the cuts
	// the plan actually publishes are named.
	const cuts = publishes(caps, "fiveHour") ? "5h/7d" : "7d";
	rows.push(["", clip("credits = list-price $ x multiplier", valueWidth("")), "muted"]);
	rows.push(["", clip(`estimate · ${cuts} cut locally`, valueWidth("")), "muted"]);
	// A payload publishing no cap set at all leaves no window to draw; say why,
	// rather than letting the block read as a plan with unlimited headroom.
	if (!hasCaps(caps)) rows.push(["", clip("no cap set published", valueWidth("")), "muted"]);
	if (usage.periodInferred) {
		// `oduse` infers the month's start from the subscription anniversary when
		// nothing pins it; the Monthly reset below then rests on a guess, and that
		// belongs beside the other caveats rather than under a countdown.
		rows.push(["", "month start inferred", "muted"]);
	}
	rows.push(
		...odWindow(
			"5-hour",
			usage.totals.fiveHour,
			caps,
			"fiveHour",
			spendOf(usage, "fiveHour"),
			usage.capPicks.get("fiveHour"),
			now,
			FIVE_HOUR_SECS,
		),
	);
	rows.push(
		...odWindow(
			"Weekly",
			usage.totals.weekly,
			caps,
			"week",
			spendOf(usage, "week"),
			usage.capPicks.get("week"),
			now,
			WEEKLY_SECS,
		),
	);
	rows.push(
		...odWindow(
			"Monthly",
			usage.totals.month,
			caps,
			"month",
			spendOf(usage, "month"),
			usage.capPicks.get("month"),
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
	const planModel = caps.planModelCreditsUsd;
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
	const byModel =
		usage.summary.requests > 0
			? modelRows(usage, (model) =>
					capOf(
						caps.byModel.get(model.id) ?? caps.defaultCaps ?? caps.legacy ?? {},
						"month",
					),
				)
			: [];
	if (byModel.length > 0) {
		rows.push(separator());
		rows.push(...byModel);
	}
	return rows;
}
