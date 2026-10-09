import { runCmduse } from "#~/data/cmduse.ts";
import { normalizeKey } from "#~/keys.ts";

export interface UsageEntry {
	key: string;
	name: string;
	requests: number;
	tokensIn: number;
	cacheRead: number;
	cacheWrite: number;
	tokensOut: number;
	/** Reasoning tokens, billed at the output rate on top of `tokensOut`. */
	reasoning: number;
	costUsd: number;
}

export interface AccountSummary {
	requests: number;
	cost: number;
	periodEnd?: string;
}

type CmduseModel = Omit<UsageEntry, "key" | "name"> & Record<string, number>;

function entryFrom(id: string, row: CmduseModel): UsageEntry {
	return {
		key: normalizeKey(id),
		name: id,
		requests: Number(row.requests ?? 0),
		tokensIn: Number(row.tokensIn ?? 0),
		cacheRead: Number(row.cacheRead ?? 0),
		cacheWrite: Number(row.cacheWrite ?? 0),
		tokensOut: Number(row.tokensOut ?? 0),
		reasoning: Number(row.reasoning ?? 0),
		costUsd: Number(row.costUsd ?? 0),
	};
}

/** Accepts the cmduse shape, `{entries: [...]}` or a bare array. */
export function parseUsage(text: string): UsageEntry[] {
	const body = JSON.parse(text) as unknown;
	const rows: UsageEntry[] = [];
	const push = (id: string, row: unknown): void => {
		if (!id || !row || typeof row !== "object") return;
		rows.push(entryFrom(id, row as CmduseModel));
	};
	if (Array.isArray(body)) {
		for (const row of body) {
			const record = (row ?? {}) as Record<string, unknown>;
			push(String(record.model ?? record.name ?? ""), record);
		}
		return rows;
	}
	const record = (body ?? {}) as Record<string, unknown>;
	if (record.models && typeof record.models === "object") {
		for (const [id, row] of Object.entries(record.models)) push(id, row);
		return rows;
	}
	if (Array.isArray(record.entries)) {
		for (const row of record.entries) {
			const item = (row ?? {}) as Record<string, unknown>;
			push(String(item.model ?? item.name ?? ""), row);
		}
	}
	return rows;
}

/** Best-effort account summary, used only for the coverage line. */
export async function accountSummary(): Promise<AccountSummary | undefined> {
	const result = await runCmduse(["-1", "--json", "-p"]);
	if (!result.ok) return undefined;
	try {
		const body = JSON.parse(result.stdout) as {
			summary?: { requests?: number; cost?: number };
			periodEnd?: string;
		};
		return {
			requests: Number(body.summary?.requests ?? 0),
			cost: Number(body.summary?.cost ?? 0),
			periodEnd: body.periodEnd,
		};
	} catch {
		return undefined;
	}
}
