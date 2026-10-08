import type { Database } from "bun:sqlite";

export interface RawTokens {
	input?: number;
	output?: number;
	reasoning?: number;
	cache?: { read?: number; write?: number };
}

/** One row of the store, reduced to what the profiler needs. */
export interface RawMessage {
	sessionID: string;
	/** Normalised: `user`, `assistant`, or a marker such as `synthetic`. */
	kind: string;
	time: number;
	/** Prompt text, when the row carries any. */
	text: string;
	model: string;
	/** Provider id, as `model.providerID` (v2) or `providerID` (legacy). */
	provider: string;
	/** Absent while a turn is still streaming. */
	tokens: RawTokens | null;
	cost: number;
}

export function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

export function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function numberOr(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parse(data: string): Record<string, unknown> | null {
	try {
		return object(JSON.parse(data));
	} catch {
		return null;
	}
}

/** Does this store use v2's message table? */
export function hasV2(db: Database): boolean {
	return Boolean(
		db
			.query(
				"SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'session_message'",
			)
			.get(),
	);
}

/**
 * v2 rows: `type` names the row, `data.model.id` the model, and only a
 * completed turn carries `tokens`.
 */
export function readV2(db: Database): RawMessage[] {
	const rows = db
		.query(
			`SELECT session_id, type, time_created, data FROM session_message
			 ORDER BY session_id, seq`,
		)
		.all() as Array<{
		session_id: string;
		type: string;
		time_created: number;
		data: string;
	}>;
	const messages: RawMessage[] = [];
	for (const row of rows) {
		const data = parse(row.data);
		if (!data) continue;
		messages.push({
			sessionID: row.session_id,
			kind: row.type,
			time: row.time_created,
			text: text(data.text),
			model: text(object(data.model).id),
			provider: text(object(data.model).providerID),
			tokens: (data.tokens as RawTokens | undefined) ?? null,
			cost: numberOr(data.cost),
		});
	}
	return messages;
}

/** Pre-v2 rows: `role` instead of `type`, and a flat `modelID`. */
export function readLegacy(db: Database): RawMessage[] {
	const rows = db
		.query(
			`SELECT session_id, time_created, data FROM message
			 ORDER BY session_id, time_created`,
		)
		.all() as Array<{
		session_id: string;
		time_created: number;
		data: string;
	}>;
	const messages: RawMessage[] = [];
	for (const row of rows) {
		const data = parse(row.data);
		if (!data) continue;
		const content = data.content;
		messages.push({
			sessionID: row.session_id,
			kind: text(data.role),
			time: row.time_created,
			text:
				text(data.text) || (typeof content === "string" ? content : ""),
			model: text(data.modelID),
			// The legacy payload records `providerID` too; hardcoding "" here
			// made every legacy session emit no `sides` at all.
			provider: text(data.providerID),
			tokens: (data.tokens as RawTokens | undefined) ?? null,
			cost: numberOr(data.cost),
		});
	}
	return messages;
}
