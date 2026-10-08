import { runCmduse } from "~/data/cmduse.ts";
import { defaultUsageLog, mergeUsage, readUsageLog } from "./log.ts";
import { scanLogs } from "./logs.ts";
import { defaultOpencodeDb, readOpencodeDb } from "./opencodeDb.ts";
import {
	type AccountSummary,
	accountSummary,
	parseUsage,
	type UsageEntry,
} from "./parse.ts";

export type { AccountSummary, UsageEntry } from "./parse.ts";

export interface UsageReportInput {
	entries: UsageEntry[];
	/** Where the numbers came from, for the header. */
	label: string;
	/** Window description, e.g. "period (since 2026-08-27)". */
	window: string;
	/** Account-level period totals, for the coverage cross-check. */
	account?: AccountSummary;
}

export type UsageWindow = "period" | "all" | `${number}d`;

/**
 * Per-model usage from cmduse. Needs a cmduse that understands `--since`
 * (0.6.x with the window feature); returns null on an older build so the
 * caller can fall back to scanning the session logs itself.
 */
async function cmduseModel(since?: Date): Promise<UsageEntry[] | null> {
	const args = ["model", "--json"];
	if (since) args.push("--since", since.toISOString());
	const result = await runCmduse(args);
	if (!result.ok || !result.stdout.trim()) return null;
	try {
		return parseUsage(result.stdout);
	} catch {
		return null;
	}
}

function sinceFor(
	window: UsageWindow,
	account?: AccountSummary,
): Date | undefined {
	if (window === "all") return undefined;
	if (window.endsWith("d")) {
		const days = Number(window.slice(0, -1));
		if (Number.isFinite(days) && days > 0) {
			return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		}
	}
	if (account?.periodEnd) {
		const end = new Date(account.periodEnd);
		const start = new Date(end);
		start.setMonth(start.getMonth() - 1);
		return start;
	}
	return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

function label(window: UsageWindow, since?: Date): string {
	if (window === "all") return "all local logs";
	if (!since) return window;
	return `${window} (since ${since.toISOString().slice(0, 10)})`;
}

/** Load the user's real per-model usage for a window. No network. */
export async function loadUsage(
	source: string | undefined,
	window: UsageWindow = "period",
	logPath?: string,
	dbPath?: string,
	sessionRoot?: string,
): Promise<UsageReportInput> {
	if (source) {
		const file = Bun.file(source);
		if (!(await file.exists()))
			throw new Error(`usage file not found: ${source}`);
		return {
			entries: parseUsage(await file.text()),
			label: source,
			window: "file",
		};
	}
	const account = await accountSummary();
	const since = sinceFor(window, account);
	const fromCmduse = await cmduseModel(since);
	const sessions = fromCmduse ?? scanLogs(since, sessionRoot);

	// opencode's own store is complete and backfilled for every provider it
	// ran, so it supersedes the provider plugin's log (a subset of it).
	const db = readOpencodeDb(dbPath ?? defaultOpencodeDb(), since);
	const log = db ? null : readUsageLog(logPath ?? defaultUsageLog(), since);

	const sources: string[] = [];
	if (db) {
		sources.push(
			`opencode db (${db.providers.length} providers, ${db.records} records)`,
		);
	}
	if (log) sources.push("provider usage log");
	if (sessions.length > 0) {
		sources.push(fromCmduse ? "cmduse model --json" : "local session logs");
	}

	const entries = mergeUsage(
		mergeUsage(db?.entries ?? [], log ?? []),
		sessions,
	);
	return {
		entries,
		label: sources.join(" + ") || "no usage found",
		window: label(window, since),
		account,
	};
}
