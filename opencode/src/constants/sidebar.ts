// Sidebar layout budget and the shared table/window constants its rows read.
import type { Category } from "../gating";
import type { Prefs } from "../sidebar/prefs";

/**
 * The sidebar is 42 columns wide with 2+2 padding, and our panel keeps one more
 * column clear on the right, so a rendered row must stay within this. Rows that
 * cannot fit are split across an indented continuation rather than wrapping in
 * the host's renderer, which is what made the panel look broken.
 */
export const ROW_WIDTH = 37;

/** Tier label per gating category. */
export const TIER_DISPLAY: Readonly<Record<Category, string>> = {
	opensource: "open source",
	premium: "premium",
};

/** Go's documented per-model window shares of the monthly allowance. */
export const GO_WINDOW_SHARE = {
	fiveHour: 0.2,
	weekly: 0.5,
	month: 1,
} as const;

/** 5-hour window length in seconds. Mirrors cmduse_core::FIVE_HOUR_SECS. */
export const FIVE_HOUR_SECS = 5 * 3600;

/** Weekly window length in seconds. Mirrors cmduse_core::WEEKLY_SECS. */
export const WEEKLY_SECS = 7 * 86400;

/** Colour is OFF unless asked for (see sidebar/prefs.ts). */
export const PREF_DEFAULTS: Prefs = { colors: false };
