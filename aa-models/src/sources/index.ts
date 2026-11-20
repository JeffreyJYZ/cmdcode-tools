import type { Model } from "#~/model.ts";
import { readCache, writeCache } from "./cache.ts";
import { collectSources } from "./collect.ts";
import { lastGoodNote, readLastGood, writeLastGood } from "./lastGood.ts";
import { mergeModels } from "./normalize.ts";

export interface LoadOptions {
	/** AA API key; absent means keyless sources only. */
	apiKey?: string;
	/** Skip the API even when a key exists. */
	noApi?: boolean;
	/** Force a refetch, ignoring the cache. */
	refresh?: boolean;
	/** Cache TTL in ms; 0 disables reads and writes. */
	cacheTtlMs: number;
	/**
	 * Leave both stores untouched: no TTL cache, no last-good rewrite, and no
	 * last-good replay. `aam check` sets it on the dispatch load, then reloads
	 * with it set too — a diagnostic must describe the poisoned store, not paper
	 * over it with the fallback it is meant to diagnose.
	 */
	noCacheWrite?: boolean;
}

export interface Catalogue {
	models: Model[];
	/** Which loaders answered, e.g. ["manifest", "leaderboard"]. */
	sources: string[];
	indexVersion: string | null;
	fetchedAt: string;
	/**
	 * True when part of this came from the last-good fallback: a source failed and
	 * its figures were replayed. The note beside it names the replay's age.
	 */
	stale: boolean;
	/** Non-fatal problems, one line each, for the footer and `--json`. */
	notes: string[];
}

const SOURCE_ORDER = ["manifest", "leaderboard", "models", "api"];

/**
 * The one entry point: manifest leads (lane B), the keyless pages fill index,
 * speed, price and context, then the API when a key exists. Every source fails
 * soft into `notes`; only a total failure throws, naming the endpoints.
 *
 * A source that fails costs its columns, so whatever it alone supplied is
 * replayed from the last-good catalogue — gaps only, never over a live figure —
 * and the run says `stale` with the replay's age rather than passing stored data
 * off as fresh.
 */
export async function loadCatalogue(options: LoadOptions): Promise<Catalogue> {
	const ttl = options.cacheTtlMs;
	const persist = options.noCacheWrite !== true;
	if (ttl > 0 && !options.refresh) {
		const cached = await readCache(ttl);
		if (cached) return { ...cached, stale: false };
	}

	const live = await collectSources(options);
	const notes = [...live.notes];
	let models = mergeModels(live.groups);
	// Read the store only when it can be used: a healthy run never pays for parsing
	// a catalogue it will not replay from.
	const stored =
		persist && (live.degraded || models.length === 0) ? await readLastGood() : undefined;
	if (models.length === 0) {
		if (!stored) throw new Error(notes.join("; ") || "every source failed");
		return {
			models: stored.models,
			sources: sourcesOf(stored.models),
			indexVersion: null,
			fetchedAt: new Date(stored.fetchedAt).toISOString(),
			stale: true,
			notes: [...notes, lastGoodNote(stored)],
		};
	}
	if (live.degraded && stored) {
		models = mergeModels([...live.groups, stored.models], true);
		notes.push(lastGoodNote(stored));
	}

	const catalogue: Catalogue = {
		models,
		sources: sourcesOf(models),
		indexVersion: live.indexVersion,
		fetchedAt: new Date().toISOString(),
		stale: live.degraded && stored !== undefined,
		notes,
	};
	// A partial run never overwrites the store: its age is what a later replay
	// reports, so it may only be stamped by a run that saw every source answer.
	if (persist && !live.degraded) {
		await writeLastGood(models);
		if (ttl > 0) {
			await writeCache({
				models,
				sources: catalogue.sources,
				indexVersion: live.indexVersion,
				fetchedAt: catalogue.fetchedAt,
				notes,
			});
		}
	}
	return catalogue;
}

function sourcesOf(models: Model[]): string[] {
	const seen = new Set(models.flatMap((model) => model.sources));
	const ordered = SOURCE_ORDER.filter((source) => seen.has(source));
	for (const source of seen) if (!ordered.includes(source)) ordered.push(source);
	return ordered;
}
