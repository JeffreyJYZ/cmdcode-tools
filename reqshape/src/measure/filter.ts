import { FILLER } from "#~/constants/keywords.ts";
import type { Ask, DropCount } from "#~/types.ts";

export interface FilterOptions {
	/** `user` keeps only the prompts you typed, dropping subagent sessions. */
	sessions: "user" | "all";
	keywords: Set<string>;
	minChars: number;
	minOutput: number;
	keepTrivial: boolean;
	/** Epoch ms floor; 0 keeps everything. */
	since: number;
	/** Substring matched against the session's directory; "" keeps everything. */
	project: string;
}

export interface FilterResult {
	kept: Ask[];
	drops: DropCount[];
}

/** Lowercase, punctuation-free, single-spaced — so `Hi!` and `hi` are the same prompt. */
export function normalizePrompt(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Why this prompt is noise, or null when it is worth profiling. A prompt made
 * only of emoji normalises away to nothing, which is its own answer.
 */
export function trivialReason(
	text: string,
	keywords: Set<string>,
	minChars: number,
): string | null {
	const normalized = normalizePrompt(text);
	if (!normalized) return "empty prompt";
	if (keywords.has(normalized)) return "trivial prompt";
	const words = normalized.split(" ");
	if (
		words.length > 1 &&
		words.some((word) => keywords.has(word)) &&
		words.every((word) => keywords.has(word) || FILLER.has(word))
	) {
		return "trivial prompt";
	}
	if (minChars > 0 && normalized.length < minChars) return "short prompt";
	return null;
}

function outputOf(ask: Ask): number {
	let total = 0;
	for (const req of ask.reqs) total += req.output;
	return total;
}

function dropOf(ask: Ask, reason: string, seen: Map<string, DropCount>): void {
	const entry = seen.get(reason) ?? { reason, asks: 0, reqs: 0 };
	entry.asks += 1;
	entry.reqs += ask.reqs.length;
	seen.set(reason, entry);
}

/**
 * Decide which asks describe real work. Every rejection is counted, so the
 * numbers stay auditable rather than quietly cleaned.
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
		if (!options.keepTrivial) {
			const reason = trivialReason(
				ask.text,
				options.keywords,
				options.minChars,
			);
			if (reason) {
				dropOf(ask, reason, drops);
				continue;
			}
			if (options.minOutput > 0 && outputOf(ask) < options.minOutput) {
				dropOf(ask, "under --min-output", drops);
				continue;
			}
		}
		kept.push(ask);
	}

	return { kept, drops: [...drops.values()].sort((a, b) => b.reqs - a.reqs) };
}
