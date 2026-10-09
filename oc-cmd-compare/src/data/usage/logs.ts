import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeKey } from "#~/keys.ts";
import type { UsageEntry } from "./parse.ts";

interface Totals {
	requests: number;
	tokensIn: number;
	cacheRead: number;
	cacheWrite: number;
	tokensOut: number;
	reasoning: number;
	costUsd: number;
}

function empty(): Totals {
	return {
		requests: 0,
		tokensIn: 0,
		cacheRead: 0,
		cacheWrite: 0,
		tokensOut: 0,
		// The CommandCode session-log usage block carries no reasoning counter.
		reasoning: 0,
		costUsd: 0,
	};
}

function jsonlFiles(dir: string, out: string[]): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		const path = join(dir, name);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (stat.isDirectory()) jsonlFiles(path, out);
		else if (
			name.endsWith(".jsonl") &&
			!name.endsWith(".checkpoints.jsonl")
		) {
			out.push(path);
		}
	}
	return out;
}

interface Line {
	timestamp?: string;
	model?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		costUsd?: number;
	};
}

/**
 * Aggregate per-model usage from the local CommandCode session logs. Unlike
 * `cmduse model`, this honours a date window so it can match a billing period.
 */
export function scanLogs(
	since?: Date,
	root = join(homedir(), ".commandcode", "projects"),
): UsageEntry[] {
	const byModel = new Map<string, { name: string; totals: Totals }>();

	for (const file of jsonlFiles(root, [])) {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const raw of text.split("\n")) {
			if (!raw?.includes('"usage"')) continue;
			let line: Line;
			try {
				line = JSON.parse(raw) as Line;
			} catch {
				continue;
			}
			if (!line.usage || !line.model) continue;
			if (since && line.timestamp && new Date(line.timestamp) < since)
				continue;
			const key = normalizeKey(line.model);
			const bucket = byModel.get(key) ?? {
				name: line.model,
				totals: empty(),
			};
			const t = bucket.totals;
			t.requests += 1;
			t.tokensIn += line.usage.inputTokens ?? 0;
			t.tokensOut += line.usage.outputTokens ?? 0;
			t.cacheRead += line.usage.cacheReadTokens ?? 0;
			t.cacheWrite += line.usage.cacheWriteTokens ?? 0;
			t.costUsd += line.usage.costUsd ?? 0;
			byModel.set(key, bucket);
		}
	}

	return [...byModel].map(([key, { name, totals }]) => ({
		key,
		name,
		...totals,
	}));
}
