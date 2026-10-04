// Pure row builder for the "Command Code" session-sidebar section.
//
// Rows are `[label, value]` pairs plus standalone banners (`[message, ""]`),
// the same shape cmd-provider's deals panel uses. Keeping this pure makes the
// panel trivial to test and host-agnostic (v1 and v2 pass the same inputs).
import {
	type Category,
	canonicalizeModelId,
	MODEL_CATEGORIES,
} from "../gating";
import {
	elapsedLabel,
	FIVE_HOUR_SECS,
	paceEtaSecs,
	WEEKLY_SECS,
} from "./windows";

/**
 * Colour role for a row's *value*, resolved against the host theme by the
 * panel: `ok` / `warn` / `crit` are headroom (green / amber / red), `strong` is
 * plain text in bold (the model name, the way mpc bolds its MODEL column),
 * `muted` is for continuations and rules, `base` is plain text. Labels are
 * coloured separately: the panel draws them in the theme's info hue.
 */
export type Tone = "base" | "muted" | "strong" | "ok" | "warn" | "crit";

/**
 * A row. `headline` marks the two rows whose label names the thing the panel is
 * about (the plan, the active model); the panel colours their labels apart.
 */
export type SidebarRow = [
	label: string,
	value: string,
	tone?: Tone,
	headline?: true,
];

/** Headroom severity: comfortable to 70%, tight to 90%, over after that. */
export function pctTone(pct: number): Tone {
	if (pct >= 90) return "crit";
	if (pct >= 70) return "warn";
	return "ok";
}

/**
 * The sidebar is 42 columns wide with 2+2 padding, and our panel keeps one more
 * column clear on the right, so a rendered row must stay within this. Rows that
 * cannot fit are split across an indented continuation (`""` label) rather than
 * wrapping in the host's renderer, which is what made the panel look broken.
 */
export const ROW_WIDTH = 37;

/** A horizontal rule between blocks. */
export function separator(): SidebarRow {
	return ["─".repeat(ROW_WIDTH), "", "muted"];
}

/** Truncate to `width`, ellipsis included. */
export function clip(text: string, width: number = ROW_WIDTH): string {
	return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/** Value budget for a labelled row: the panel draws `label: value`. */
export function valueWidth(label: string): number {
	return ROW_WIDTH - label.length - 2;
}

/** How the panel splits a row: a muted label (or banner) and a toned value. */
export function parts(row: SidebarRow): [label: string, value: string] {
	if (row[0] === "") return [`  ${row[1]}`, ""];
	return [row[1] ? `${row[0]}: ` : row[0], row[1]];
}

/** Rendered width of a row, as the panel draws it. */
export function rowWidth(row: SidebarRow): number {
	if (row[0] === "") return 2 + row[1].length;
	return row[1] ? row[0].length + 2 + row[1].length : row[0].length;
}

export interface ModelMeta {
	key: string;
	name: string;
	tier?: Category;
	/** Cheapest plan that serves the model, from the generated catalog. */
	minPlan?: string | null;
	allowance?: number;
	rates?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite?: number | null;
	};
	intelligence?: number;
	tps?: number;
	/**
	 * Promotion CommandCode is running on this model (0.3.13): the badge from
	 * the docs row, with its expiry line when the page publishes one.
	 */
	deal?: { badge: string; ends?: string };
	/**
	 * The OpenCode Go / Zen side of the same mpc row (0.4.0): the CommandCode
	 * fields above are the default, this is what a Go/Zen session reads.
	 */
	oc?: {
		provider?: string;
		plan?: string;
		allowance?: number;
		rates?: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite?: number | null;
		};
		ability?: number;
		tps?: number;
	};
}

export interface WindowUsage {
	cap?: number;
	used?: number;
	resetAt?: number;
	/** The account API's own over-cap flag (cmduse passes it through). */
	exceeded?: boolean;
}

/** One model's usage for the account's current billing period. */
export interface ModelUsage {
	requests: number;
	cost: number;
}

export interface Usage {
	plan?: string;
	monthlyCap?: number;
	monthlyCredits?: number;
	/** Billing-period bounds in epoch ms (cmduse 0.7.2+); absent on older builds. */
	periodStartAt?: number;
	periodEndAt?: number;
	fiveHour?: WindowUsage;
	weekly?: WindowUsage;
	periodEnd?: string;
	requests?: number;
	cost?: number;
	/**
	 * cmduse's own fetch error. `cmduse -1 --json` still exits 0 when the account
	 * API is unreachable, and then publishes the *defaults* (plan "Free", no
	 * windows) beside this string — the human renderer hides that fake frame, and
	 * a consumer must too, or it paints "Free" with no Monthly row over a good
	 * snapshot. See `loadUsage`.
	 */
	error?: string;
}

const TIER_DISPLAY: Readonly<Record<Category, string>> = {
	opensource: "open source",
	premium: "premium",
};

/** Money at credit scale: cents, but "$60" not "$60.00". */
export function money(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return `$${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

/** Rate scale needs more precision than credit scale ($0.0036). */
export function rate(value: number): string {
	if (value === 0) return "$0";
	return `$${Number(value.toFixed(4))}`;
}

export function count(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(Math.round(value));
}

/** "3h 12m" / "1d 20h" / "<1m" for a reset epoch. */
export function until(epoch: number | undefined, now = Date.now()): string {
	if (!epoch) return "";
	const secs = Math.max(0, Math.round((epoch - now) / 1000));
	if (secs < 60) return "<1m";
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/** A rolling window as two rows: the use line, then resets plus whatever needs
 * flagging. The lead segment follows cmduse's importance order — over-cap flag,
 * then the cap ETA, then the informational elapsed share — because the
 * 37-column budget fits exactly one of them beside the reset countdown. */
function windowRows(
	label: string,
	w: WindowUsage | undefined,
	now: number,
	durSecs: number,
): SidebarRow[] {
	if (!w || typeof w.cap !== "number" || w.cap <= 0) return [];
	const used = typeof w.used === "number" ? w.used : 0;
	const pct = (used / w.cap) * 100;
	const nowSecs = Math.floor(now / 1000);
	const elapsed = elapsedLabel(w.resetAt, durSecs, nowSecs);
	const eta = paceEtaSecs(w.resetAt, durSecs, used, w.cap, nowSecs);
	const reset = until(w.resetAt, now);
	const lead = w.exceeded
		? "LIMIT EXCEEDED"
		: eta === undefined
			? elapsed === undefined
				? ""
				: `${elapsed} elapsed`
			: `cap in ${until(now + eta * 1000, now)}`;
	const detail = [lead, reset ? `resets ${reset}` : ""]
		.filter(Boolean)
		.join(" · ");
	// Compact on the use line (`$0.55/$14`, no spaces) so larger numbers still fit.
	return [
		[
			label,
			`${money(used)}/${money(w.cap)} (${pct.toFixed(1)}%)`,
			w.exceeded ? "crit" : pctTone(pct),
		],
		...(detail ? [["", detail, "muted"] as SidebarRow] : []),
	];
}

/**
 * Monthly is a billing period, not one of the fixed rolling windows, so its
 * length comes from the bounds cmduse publishes in epoch ms (0.7.2+) rather than
 * from a name. Without both bounds there is no resets time and no elapsed share
 * to show, and the row keeps to spend alone.
 */
function monthlyDetail(usage: Usage, now: number): string | undefined {
	const { periodStartAt, periodEndAt } = usage;
	if (typeof periodStartAt !== "number" || typeof periodEndAt !== "number")
		return undefined;
	const durSecs = Math.round((periodEndAt - periodStartAt) / 1000);
	if (durSecs <= 0) return undefined;
	const elapsed = elapsedLabel(periodEndAt, durSecs, Math.floor(now / 1000));
	const reset = until(periodEndAt, now);
	const parts = [
		...(elapsed === undefined ? [] : [`${elapsed} elapsed`]),
		...(reset ? [`resets ${reset}`] : []),
	];
	return parts.length ? parts.join(" · ") : undefined;
}

/** Plan + rolling windows + period totals, from a cmduse snapshot. */
export function usageRows(
	usage: Usage | undefined,
	now = Date.now(),
): SidebarRow[] {
	if (!usage) return [];
	const rows: SidebarRow[] = [];
	if (usage.plan) {
		const credits =
			typeof usage.monthlyCap === "number"
				? ` · $${usage.monthlyCap}/mo credits`
				: "";
		rows.push(["Plan", `${usage.plan}${credits}`, "base", true]);
	}
	if (
		typeof usage.monthlyCap === "number" &&
		typeof usage.monthlyCredits === "number"
	) {
		// cmduse clamps used into [0, cap]: leftover credits can exceed the cap.
		const used = Math.min(
			usage.monthlyCap,
			Math.max(0, usage.monthlyCap - usage.monthlyCredits),
		);
		const pct = usage.monthlyCap > 0 ? (used / usage.monthlyCap) * 100 : 0;
		rows.push([
			"Monthly",
			`${money(used)} / ${money(usage.monthlyCap)} (${pct.toFixed(1)}%)`,
			pctTone(pct),
		]);
		const detail = monthlyDetail(usage, now);
		if (detail) rows.push(["", detail, "muted"]);
	}
	rows.push(...windowRows("5-hour", usage.fiveHour, now, FIVE_HOUR_SECS));
	rows.push(...windowRows("Weekly", usage.weekly, now, WEEKLY_SECS));
	if (typeof usage.requests === "number" || typeof usage.cost === "number") {
		const parts: string[] = [];
		if (typeof usage.requests === "number")
			parts.push(`${count(usage.requests)} requests`);
		if (typeof usage.cost === "number") parts.push(money(usage.cost));
		rows.push(["Period", parts.join(" · "), "base"]);
	}
	return rows;
}

/** Active model's allowance, rates and benchmarks, from mpc's catalog; its
 * period usage (when the store has it) rides directly under the model name, and
 * this session's own totals under that (0.4.0).
 *
 * `fallbackName` keeps the block on screen when the catalog is unavailable: the
 * `Usage (this model)`/`Session` rows come from the local store and need no
 * network, so an outage must not hide them behind a failed mpc spawn. The name
 * is the only thing borrowed, and it is the session's own id when no catalog
 * row names the model. */
export function modelRows(
	meta: ModelMeta | undefined,
	usage?: ModelUsage,
	session?: ModelUsage,
	fallbackName?: string,
): SidebarRow[] {
	const name = meta?.name ?? fallbackName;
	if (!name) return [];
	const rows: SidebarRow[] = [
		["Model", clip(name, valueWidth("Model")), "strong", true],
	];
	if (usage) {
		// CommandCode is subscription-billed, so the harness only prices a model
		// when it knows the rates; the share of the session goes beside the spend,
		// because a figure without its denominator says little. The two figures
		// come from different writes — the model's from summing `session_message`
		// rows, the session's from `session_v2.cost` — so for the moment between a
		// turn's row landing and the session total catching up the numerator can
		// lead, which flashed "105% of session" then settled to 100%. A part of a
		// whole never reads over the whole: clamp it.
		rows.push(["Usage (this model)", `${count(usage.requests)} req`, "base"]);
		const spend = usage.cost > 0 ? money(usage.cost) : "";
		const share =
			usage.cost > 0 && session && session.cost > 0
				? `${Math.min(100, Math.round((usage.cost / session.cost) * 100))}% of session`
				: "";
		const detail = [spend, share].filter(Boolean).join(" · ");
		if (detail) rows.push(["", detail, "muted"]);
	}
	if (session) {
		const spent = session.cost > 0 ? ` · ${money(session.cost)}` : "";
		rows.push(["Session", `${count(session.requests)} req${spent}`, "base"]);
	}
	// Everything below is catalog data; without it the block is just the model
	// and its local figures.
	if (!meta) return rows;
	if (meta.tier) rows.push(["Tier", TIER_DISPLAY[meta.tier], "base"]);
	// Min plan is the fallback, not a second opinion: the docs' access rule
	// (models.md's Min plan column) covers models the gating snapshot has no
	// tier for, and showing both read as redundant once gating could refresh.
	else if (meta.minPlan) rows.push(["Min plan", meta.minPlan, "base"]);
	if (typeof meta.allowance === "number")
		rows.push(["Allowance", `${money(meta.allowance)}/mo`, "base"]);
	if (meta.deal) {
		// The badge is the news; the expiry is compacted to fit ("Sep 30" rather
		// than "Ends September 30, 2026"), because the sidebar has 37 columns.
		const ends = meta.deal.ends?.match(/([A-Z][a-z]{2})[a-z]*\s+(\d{1,2})/);
		rows.push([
			"Deal",
			ends
				? `${meta.deal.badge} · ends ${ends[1]} ${ends[2]}`
				: meta.deal.badge,
			"ok",
		]);
	}
	if (meta.rates) {
		// In/out leads; the cache rates ride on an indented continuation, since
		// all three on one line overflows the sidebar. Cache write appears only
		// when the model has one (Claude does, the DeepSeek/GLM lines do not), so
		// a zero rate never reads as a price.
		const cache = [`cache read ${rate(meta.rates.cacheRead)}`];
		if (
			typeof meta.rates.cacheWrite === "number" &&
			meta.rates.cacheWrite > 0
		) {
			cache.push(`write ${rate(meta.rates.cacheWrite)}`);
		}
		rows.push([
			"Rates",
			`${rate(meta.rates.input)}/${rate(meta.rates.output)} in/out`,
			"base",
		]);
		rows.push(["", cache.join(" · "), "muted"]);
	}
	if (typeof meta.intelligence === "number")
		rows.push(["Intelligence", String(meta.intelligence), "base"]);
	if (typeof meta.tps === "number")
		rows.push(["Tok/s", String(meta.tps), "base"]);
	return rows;
}

/**
 * Canonical key for a model id, mirroring mpc's normalizeKey: lowercase, drop
 * the vendor prefix and any parenthetical, strip punctuation. Used to match the
 * session's active model against the mpc catalog.
 */
export function modelKey(modelId: string): string {
	const bare = modelId.toLowerCase().replace(/\([^)]*\)/g, " ");
	const tail = bare.split("/").pop() ?? bare;
	return tail.replace(/[^a-z0-9]+/g, "");
}

/** Tier lookup for a model id, from the canonical gating snapshot. */
export function tierFor(modelId: string): Category | undefined {
	return MODEL_CATEGORIES[canonicalizeModelId(modelId)];
}
