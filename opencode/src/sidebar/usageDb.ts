// Per-model usage for the sidebar, read from opencode's own message store
// (`~/.local/share/opencode/opencode.db`, read-only via bun:sqlite).
//
// This is the cheap half of mpc's usage projection: one time-bounded scan for
// a single model's period totals — no catalog load, no network, no doc scrape.
// cmduse only reports account-wide totals (its API has no per-model dimension),
// so this is the only per-model source the panel can afford on a 30s poll.
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ModelUsage, modelKey } from "./rows";

/** opencode's message store: `OPENCODE_DB`, else the XDG data dir. */
export function usageDbPath(): string {
	if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
	const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(base, "opencode", "opencode.db");
}

/**
 * Start of the billing period a cmduse snapshot reports, as epoch ms. cmduse
 * 0.7.2+ publishes `periodStartAt` directly; older builds publish only
 * `periodEnd` (YYYY-MM-DD), so the start is that date one calendar month back.
 * Falls back to the last 30 days when neither is usable.
 */
export function periodStart(
	usage: { periodStartAt?: number; periodEnd?: string },
	now = Date.now(),
): number {
	if (typeof usage.periodStartAt === "number") return usage.periodStartAt;
	const end = usage.periodEnd
		? Date.parse(`${usage.periodEnd}T23:59:59`)
		: Number.NaN;
	if (!Number.isFinite(end)) return now - 30 * 24 * 60 * 60 * 1000;
	const start = new Date(end);
	start.setMonth(start.getMonth() - 1);
	return start.getTime();
}

interface AssistantData {
	role?: string;
	cost?: number;
	modelID?: string;
	tokens?: unknown;
}

function usage(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Requests and cost for one model since `sinceMs`. Null when the store is
 * missing or unreadable, so callers can fall back to omitting the row.
 * Matching is on the canonical key: the session id and the stored modelID can
 * differ by vendor prefix/punctuation.
 */
export function loadModelUsage(
	modelID: string,
	sinceMs: number,
	path = usageDbPath(),
): ModelUsage | null {
	let db: Database;
	try {
		db = new Database(path, { readonly: true });
	} catch {
		return null;
	}
	try {
		const rows = db
			.query(
				`SELECT data, time_created FROM message
				 WHERE data LIKE '%"tokens"%' AND time_created >= ?`,
			)
			.all(sinceMs) as Array<{ data: string; time_created: number }>;
		const key = modelKey(modelID);
		const seen = new Set<string>();
		let requests = 0;
		let cost = 0;
		for (const row of rows) {
			let data: AssistantData;
			try {
				data = JSON.parse(row.data) as AssistantData;
			} catch {
				continue;
			}
			if (data.role !== "assistant" || !data.modelID || !data.tokens) continue;
			if (modelKey(data.modelID) !== key) continue;
			const id = `${data.modelID}@${row.time_created}`;
			if (seen.has(id)) continue; // rows can be rewritten in place
			seen.add(id);
			requests += 1;
			cost += usage(data.cost);
		}
		return { requests, cost };
	} catch {
		return null;
	} finally {
		db.close();
	}
}

/**
 * Requests and cost for one session, so the panel can show what this
 * conversation has spent rather than only the period-to-date figure. Null when
 * the store is missing or unreadable, and callers then omit the row. Rows are
 * keyed by their primary key: message rows get rewritten in place.
 */
export function loadSessionUsage(
	sessionID: string,
	path = usageDbPath(),
): ModelUsage | null {
	let db: Database;
	try {
		db = new Database(path, { readonly: true });
	} catch {
		return null;
	}
	try {
		const rows = db
			.query(
				`SELECT id, data FROM message
				 WHERE session_id = ? AND data LIKE '%"tokens"%'`,
			)
			.all(sessionID) as Array<{ id: string; data: string }>;
		const seen = new Set<string>();
		let requests = 0;
		let cost = 0;
		for (const row of rows) {
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			let data: AssistantData;
			try {
				data = JSON.parse(row.data) as AssistantData;
			} catch {
				continue;
			}
			if (data.role !== "assistant" || !data.tokens) continue;
			requests += 1;
			cost += usage(data.cost);
		}
		return { requests, cost };
	} catch {
		return null;
	} finally {
		db.close();
	}
}
