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
import { elapsedLabel, FIVE_HOUR_SECS, WEEKLY_SECS } from "./windows";

/**
 * Colour role for a row's *value*, resolved against the host theme by the
 * panel: `ok` / `warn` / `crit` are headroom (green / amber / red), `strong` is
 * plain text in bold (the model name, the way mpc bolds its MODEL column),
 * `muted` is for continuations and rules, `base` is plain text. Labels are
 * coloured separately: the panel draws them in the theme's info hue.
 */
export type Tone = "base" | "muted" | "strong" | "ok" | "warn" | "crit";

export type SidebarRow = [label: string, value: string, tone?: Tone];

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
}

export interface WindowUsage {
	cap?: number;
	used?: number;
	resetAt?: number;
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

/** A rolling window as two rows: the use line, then elapsed + reset. */
function windowRows(
	label: string,
	w: WindowUsage | undefined,
	now: number,
	durSecs: number,
): SidebarRow[] {
	if (!w || typeof w.cap !== "number" || w.cap <= 0) return [];
	const used = typeof w.used === "number" ? w.used : 0;
	const pct = Math.round((used / w.cap) * 100);
	const elapsed = elapsedLabel(w.resetAt, durSecs, Math.floor(now / 1000));
	const reset = until(w.resetAt, now);
	const detail = [
		...(elapsed === undefined ? [] : [`${elapsed} elapsed`]),
		...(reset ? [`resets ${reset}`] : []),
	].join(" · ");
	// Compact on the use line (`$0.55/$14`, no spaces) so larger numbers still fit.
	return [
		[label, `${money(used)}/${money(w.cap)} (${pct}%)`, pctTone(pct)],
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
		rows.push(["Plan", `${usage.plan}${credits}`, "base"]);
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
		const pct =
			usage.monthlyCap > 0 ? Math.round((used / usage.monthlyCap) * 100) : 0;
		rows.push([
			"Monthly",
			`${money(used)} / ${money(usage.monthlyCap)} (${pct}%)`,
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
 * period usage (when the store has it) rides directly under the model name. */
export function modelRows(
	meta: ModelMeta | undefined,
	usage?: ModelUsage,
): SidebarRow[] {
	if (!meta) return [];
	const rows: SidebarRow[] = [
		["Model", clip(meta.name, valueWidth("Model")), "strong"],
	];
	if (usage) {
		// CommandCode is subscription-billed, so opencode records cost 0 for
		// its models: show spend only when the harness actually priced it.
		const spent = usage.cost > 0 ? ` · ${money(usage.cost)}` : "";
		rows.push([
			"Usage (this model)",
			`${count(usage.requests)} req${spent}`,
			"base",
		]);
	}
	if (meta.tier) rows.push(["Tier", TIER_DISPLAY[meta.tier], "base"]);
	// Min plan is the fallback, not a second opinion: the docs' access rule
	// (models.md's Min plan column) covers models the gating snapshot has no
	// tier for, and showing both read as redundant once gating could refresh.
	else if (meta.minPlan) rows.push(["Min plan", meta.minPlan, "base"]);
	if (typeof meta.allowance === "number")
		rows.push(["Allowance", `${money(meta.allowance)}/mo`, "base"]);
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
