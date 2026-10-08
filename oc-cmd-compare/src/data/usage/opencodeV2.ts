import type { Database } from "bun:sqlite";

/** One assistant turn, normalised across the two store layouts. */
export interface Turn {
	id: string;
	modelID: string;
	providerID: string;
	cost: number;
	tokens: {
		input?: number;
		output?: number;
		/** Separate counter, billed at the output rate on top of `output`. */
		reasoning?: number;
		cache?: { read?: number; write?: number };
	};
}

/**
 * Does this store have v2's tables? opencode v2 appends to `session_message`
 * and stopped writing `message` at the migration, so the legacy query reads
 * nothing for any session since — which is how this store looked empty.
 */
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
 * v2 turns: a *completed* assistant row carries `model`, `cost` and `tokens`; an
 * in-flight one carries only the model, so it is skipped until it finishes.
 */
export function readV2Turns(db: Database, sinceMs: number): Turn[] {
	const rows = db
		.query(
			`SELECT id, data FROM session_message
			 WHERE type = 'assistant' AND time_created >= ?`,
		)
		.all(sinceMs) as Array<{ id: string; data: string }>;
	const turns: Turn[] = [];
	for (const row of rows) {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(row.data) as Record<string, unknown>;
		} catch {
			continue;
		}
		const model = (data.model ?? {}) as {
			id?: unknown;
			providerID?: unknown;
		};
		const tokens = data.tokens as Turn["tokens"] | undefined;
		if (typeof model.id !== "string" || !tokens) continue;
		turns.push({
			id: row.id,
			modelID: model.id,
			providerID:
				typeof model.providerID === "string"
					? model.providerID
					: "unknown",
			cost: typeof data.cost === "number" ? data.cost : 0,
			tokens,
		});
	}
	return turns;
}
