// Local cost rows, memoised so the panel's poll never pays for the scan.
// Each figure lives in a `session_message` row's JSON, so summing it is an
// account-wide `json_extract … GROUP BY` over 1.3 GiB: 35ms/739ms/1 875ms for
// the 5h/7d/30d windows, with a disk-spilling sort. On the 5s poll that held the
// TUI thread 49.8% busy and lagged typing. `cost: "off"` (default) returns
// before any database is opened; an enabled mode answers from memory for `costMs`.
import { FIVE_HOUR_SECS, WEEKLY_SECS } from "../constants/sidebar";
import { loadPrefs } from "./prefs";
import type { ModelUsage } from "./rows";
import { loadModelUsage, loadModelWindowStart, loadSessionUsage, usageDbPath } from "./usageDb";
import type { ZenWindowStarts } from "./zen";

/** One memoised read: the same key inside `costMs` answers from memory. */
function memoize<T>() {
	let slot: { key: string; at: number; value?: T } | undefined;
	return {
		read(key: string, costMs: number, now: number, scan: () => T | undefined): T | undefined {
			if (slot && slot.key === key && now - slot.at < costMs) return slot.value;
			slot = { key, at: now, value: scan() };
			return slot.value;
		},
		clear(): void {
			slot = undefined;
		},
	};
}

const sessionMemo = memoize<ModelUsage>();
const modelMemo = memoize<ModelUsage>();
const windowsMemo = memoize<ZenWindowStarts>();

/** Forget every figure, so the next read scans again. */
export function resetLocalCost(): void {
	sessionMemo.clear();
	modelMemo.clear();
	windowsMemo.clear();
}

/**
 * This conversation's own totals: one indexed read on `session_v2`, the cheapest
 * row the panel has. Undefined when the cost rows are off or the host has not
 * resolved a session yet.
 */
export function sessionCost(
	sessionID: string | undefined,
	now = Date.now(),
): ModelUsage | undefined {
	const prefs = loadPrefs();
	if (prefs.cost === "off" || !sessionID) return undefined;
	return sessionMemo.read(
		sessionID,
		prefs.costMs,
		now,
		() => loadSessionUsage(sessionID) ?? undefined,
	);
}

/**
 * One model's spend inside one conversation. Session scope is required: the
 * period-wide figure counts every conversation, and dividing it by this
 * session's total read as "over 100% of session".
 */
export function modelCost(
	modelID: string | undefined,
	sessionID: string | undefined,
	now = Date.now(),
): ModelUsage | undefined {
	const prefs = loadPrefs();
	if (prefs.cost === "off" || !modelID || !sessionID) return undefined;
	return modelMemo.read(
		`${sessionID}\u0000${modelID}`,
		prefs.costMs,
		now,
		() => loadModelUsage(modelID, 0, usageDbPath(), sessionID) ?? undefined,
	);
}

/**
 * The active model's rolling-window starts. Account-wide and the most expensive
 * read here (two scans, one per window), so it is the `window` mode only.
 */
export function modelWindows(
	modelID: string | undefined,
	now = Date.now(),
): ZenWindowStarts | undefined {
	const prefs = loadPrefs();
	if (prefs.cost !== "window" || !modelID) return undefined;
	return windowsMemo.read(modelID, prefs.costMs, now, () => ({
		fiveHour: loadModelWindowStart(modelID, now - FIVE_HOUR_SECS * 1000) ?? undefined,
		weekly: loadModelWindowStart(modelID, now - WEEKLY_SECS * 1000) ?? undefined,
	}));
}
