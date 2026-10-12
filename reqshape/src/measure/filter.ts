import type { Ask, DropCount } from "#~/types.ts";

export interface FilterOptions {
	/** `user` keeps only the prompts you typed, dropping subagent sessions. */
	sessions: "user" | "all";
	/** Epoch ms floor; 0 keeps everything. */
	since: number;
	/** Substring matched against the session's directory; "" keeps everything. */
	project: string;
}

export interface FilterResult {
	kept: Ask[];
	drops: DropCount[];
}

function dropOf(ask: Ask, reason: string, seen: Map<string, DropCount>): void {
	const entry = seen.get(reason) ?? { reason, asks: 0, reqs: 0 };
	entry.asks += 1;
	entry.reqs += ask.reqs.length;
	seen.set(reason, entry);
}

/**
 * Decide which asks describe real work. Only structural noise is dropped —
 * generated rows and asks with no model call — so every prompt you typed is
 * profiled, however short. Every rejection is counted, so the numbers stay
 * auditable rather than quietly cleaned.
 */
export function filterAsks(asks: Ask[], options: FilterOptions): FilterResult {
	const kept: Ask[] = [];
	const drops = new Map<string, DropCount>();

	for (const ask of asks) {
		if (options.since > 0 && ask.time > 0 && ask.time < options.since) {
			dropOf(ask, "before --since", drops);
			continue;
		}
		if (options.project && !ask.directory.includes(options.project)) {
			dropOf(ask, "other project", drops);
			continue;
		}
		if (options.sessions === "user" && ask.child) {
			dropOf(ask, "subagent session", drops);
			continue;
		}
		if (ask.kind !== "user") {
			dropOf(ask, `${ask.kind} prompt`, drops);
			continue;
		}
		if (ask.reqs.length === 0) {
			dropOf(ask, "no model call", drops);
			continue;
		}
		kept.push(ask);
	}

	return { kept, drops: [...drops.values()].sort((a, b) => b.reqs - a.reqs) };
}
