import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeKey } from "#~/keys.ts";
import type { UsageEntry } from "./parse.ts";

interface LogLine {
	ts?: string;
	model?: string;
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
	output?: number;
	reasoning?: number;
	costUsd?: number;
}

/** Default path a per-request JSONL log lives at. */
export function defaultUsageLog(): string {
	if (process.env.MPC_USAGE_LOG) return process.env.MPC_USAGE_LOG;
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, "mpc", "usage.jsonl");
}

/**
 * Aggregate a per-request JSONL log. This is the complete opencode-side mix
 * when opencode's own store is unavailable.
 */
export function readUsageLog(path: string, since?: Date): UsageEntry[] | null {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return null;
	}
	const byKey = new Map<string, UsageEntry>();
	for (const raw of text.split("\n")) {
		if (!raw.trim()) continue;
		let line: LogLine;
		try {
			line = JSON.parse(raw) as LogLine;
		} catch {
			continue;
		}
		if (!line.model) continue;
		if (since && line.ts && new Date(line.ts) < since) continue;
		const key = normalizeKey(line.model);
		const entry = byKey.get(key) ?? {
			key,
			name: line.model,
			requests: 0,
			tokensIn: 0,
			cacheRead: 0,
			cacheWrite: 0,
			tokensOut: 0,
			reasoning: 0,
			costUsd: 0,
		};
		entry.requests += 1;
		entry.tokensIn += line.input ?? 0;
		entry.cacheRead += line.cacheRead ?? 0;
		entry.cacheWrite += line.cacheWrite ?? 0;
		entry.tokensOut += line.output ?? 0;
		entry.reasoning += line.reasoning ?? 0;
		entry.costUsd += line.costUsd ?? 0;
		byKey.set(key, entry);
	}
	return [...byKey.values()];
}

/** Sum two usage lists by model key. */
export function mergeUsage(a: UsageEntry[], b: UsageEntry[]): UsageEntry[] {
	const byKey = new Map(a.map((entry) => [entry.key, { ...entry }]));
	for (const entry of b) {
		const existing = byKey.get(entry.key);
		if (!existing) {
			byKey.set(entry.key, { ...entry });
			continue;
		}
		existing.requests += entry.requests;
		existing.tokensIn += entry.tokensIn;
		existing.cacheRead += entry.cacheRead;
		existing.cacheWrite += entry.cacheWrite;
		existing.tokensOut += entry.tokensOut;
		existing.reasoning += entry.reasoning;
		existing.costUsd += entry.costUsd;
	}
	return [...byKey.values()];
}
