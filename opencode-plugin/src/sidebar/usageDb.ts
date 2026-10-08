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
import { OPENCODE_DB_FILE, OPENCODE_DIR } from "../constants/paths";
import { type ModelUsage, modelKey } from "./rows";

/** opencode's message store: `OPENCODE_DB`, else the XDG data dir. */
export function usageDbPath(): string {
	if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
	const base =
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(base, OPENCODE_DIR, OPENCODE_DB_FILE);
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
 * Does this store have v2's tables? opencode v2 writes messages to
 * `session_message` (with per-session totals in `session_v2`) and stopped
 * appending to the legacy `message` table at the migration, so reading the old
 * one reports zero for every recent session — which is exactly what the sidebar
 * did until 0.3.13.
 */
function hasV2(db: Database): boolean {
	const row = db
		.query(
			"SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'session_message'",
		)
		.get();
	return Boolean(row);
}

/**
 * Requests and cost for one model since `sinceMs`. Null when the store is
 * missing or unreadable, so callers can fall back to omitting the row.
 * Matching is on the canonical key: the session id and the stored modelID can
 * differ by vendor prefix/punctuation.
 *
 * Given a `sessionID`, the scan is scoped to that conversation and `sinceMs` is
 * ignored — the panel shows "this model in this session" beside the session's
 * own total, and two figures measuring different windows than each other read
 * as a bug (the billing period had just rolled over, so the model row said 129
 * while the session said 2.7K).
 */
export function loadModelUsage(
	modelID: string,
	sinceMs: number,
	path = usageDbPath(),
	sessionID?: string,
): ModelUsage | null {
	let db: Database;
	try {
		db = new Database(path, { readonly: true });
	} catch {
		return null;
	}
	try {
		if (hasV2(db)) {
			// v2 keeps a model ref per assistant message, and a *completed* turn
			// carries its own cost (an in-flight one does not), so per-model spend
			// is exact rather than an estimate.
			const rows = db
				.query(
					`SELECT json_extract(data, '$.model.id') AS model,
					        count(*) AS c,
					        coalesce(sum(json_extract(data, '$.cost')), 0) AS cost
					 FROM session_message
					 WHERE type = 'assistant'
					   ${sessionID ? "AND session_id = ?" : "AND time_created >= ?"}
					 GROUP BY model`,
				)
				.all(sessionID ?? sinceMs) as Array<{
				model: string | null;
				c: number;
				cost: number;
			}>;
			const key = modelKey(modelID);
			let requests = 0;
			let cost = 0;
			for (const row of rows) {
				if (row.model && modelKey(row.model) === key) {
					requests += row.c;
					cost += row.cost;
				}
			}
			return { requests, cost };
		}
		const rows = db
			.query(
				`SELECT data, time_created FROM message
				 WHERE data LIKE '%"tokens"%'
				   ${sessionID ? "AND session_id = ?" : "AND time_created >= ?"}`,
			)
			.all(sessionID ?? sinceMs) as Array<{
			data: string;
			time_created: number;
		}>;
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
			if (data.role !== "assistant" || !data.modelID || !data.tokens)
				continue;
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
		if (hasV2(db)) {
			// v2 keeps the session's own totals as columns: one indexed read for
			// spend, plus a count of assistant turns.
			const totals = db
				.query("SELECT cost FROM session_v2 WHERE id = ?")
				.get(sessionID) as { cost?: number } | null;
			const counted = db
				.query(
					"SELECT count(*) AS c FROM session_message WHERE session_id = ? AND type = 'assistant'",
				)
				.get(sessionID) as { c: number };
			return {
				requests: counted.c,
				cost: typeof totals?.cost === "number" ? totals.cost : 0,
			};
		}
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
