import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeKey } from "~/keys.ts";
import { hasV2, readV2Turns, type Turn } from "./opencodeV2.ts";
import type { UsageEntry } from "./parse.ts";

/** Default location of opencode's message store. */
export function defaultOpencodeDb(): string {
	if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
	const base =
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(base, "opencode", "opencode.db");
}

interface AssistantData {
	role?: string;
	cost?: number;
	modelID?: string;
	providerID?: string;
	tokens?: {
		input?: number;
		output?: number;
		reasoning?: number;
		cache?: { read?: number; write?: number };
	};
	time?: { created?: number; completed?: number };
}

function numberOr(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export interface OpencodeDbUsage {
	entries: UsageEntry[];
	/** Providers seen, for the report's source line. */
	providers: string[];
	/** Total assistant records scanned, before de-duplication. */
	records: number;
}

/**
 * Aggregate per-model usage from opencode's own message store. This is the
 * complete, backfilled record for every provider opencode ran — unlike the
 * provider plugin's log, which only sees its own traffic.
 *
 * Reads v2's `session_message` when the store has it, and the legacy `message`
 * table otherwise, so an upgraded opencode does not read as "no usage". Read-only
 * so a running opencode is unaffected; returns null when the DB is unusable.
 */
export function readOpencodeDb(
	path: string,
	since?: Date,
): OpencodeDbUsage | null {
	let db: Database;
	try {
		db = new Database(path, { readonly: true });
	} catch {
		return null;
	}
	try {
		const sinceMs = since ? since.getTime() : 0;
		const turns = hasV2(db)
			? readV2Turns(db, sinceMs)
			: readLegacyTurns(db, sinceMs);

		const byKey = new Map<string, UsageEntry>();
		const seen = new Set<string>();
		const providers = new Set<string>();
		for (const turn of turns) {
			if (seen.has(turn.id)) continue; // turn rows can be rewritten in place
			seen.add(turn.id);
			providers.add(turn.providerID);

			const key = normalizeKey(turn.modelID);
			const entry = byKey.get(key) ?? {
				key,
				name: turn.modelID,
				requests: 0,
				tokensIn: 0,
				cacheRead: 0,
				cacheWrite: 0,
				tokensOut: 0,
				reasoning: 0,
				costUsd: 0,
			};
			entry.requests += 1;
			entry.tokensIn += numberOr(turn.tokens.input);
			entry.cacheRead += numberOr(turn.tokens.cache?.read);
			entry.cacheWrite += numberOr(turn.tokens.cache?.write);
			entry.tokensOut += numberOr(turn.tokens.output);
			entry.reasoning += numberOr(turn.tokens.reasoning);
			entry.costUsd += numberOr(turn.cost);
			byKey.set(key, entry);
		}
		return {
			entries: [...byKey.values()],
			providers: [...providers],
			records: turns.length,
		};
	} catch {
		return null;
	} finally {
		db.close();
	}
}

/** The pre-v2 layout: `message.data` carries the model, cost and tokens flat. */
function readLegacyTurns(db: Database, sinceMs: number): Turn[] {
	const rows = db
		.query(
			`SELECT data FROM message
			 WHERE data LIKE '%"tokens"%' AND time_created >= ?`,
		)
		.all(sinceMs) as Array<{ data: string }>;
	const turns: Turn[] = [];
	for (const row of rows) {
		let data: AssistantData;
		try {
			data = JSON.parse(row.data) as AssistantData;
		} catch {
			continue;
		}
		if (data.role !== "assistant" || !data.modelID || !data.tokens)
			continue;
		turns.push({
			id: `${data.modelID}@${(data.time?.created ?? 0) as number}`,
			modelID: data.modelID,
			providerID: data.providerID ?? "unknown",
			cost: numberOr(data.cost),
			tokens: data.tokens,
		});
	}
	return turns;
}
