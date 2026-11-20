import type { Model } from "#~/model.ts";
import { readCache, writeCache } from "./cache.ts";
import { collectSources } from "./collect.ts";
import { lastGoodNote, mergeStore, readLastGood, writeLastGood } from "./lastGood.ts";
import { importMpcStore } from "./mpcStore.ts";
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
	 * Leave both stores untouched: no TTL cache, no last-good rewrite, no
	 * last-good replay and no legacy import. `aam check` sets it on the dispatch
	 * load, then reloads with it set too — a diagnostic must describe the
	 * poisoned store, not paper over it with the fallback it is meant to diagnose.
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
 *
 * A healthy run still overlays the store's *better-ranked* tiers (an api-tier
 * median the keyless sources cannot publish), because a fallback that only ever
 * loses ground is how one keyless run used to wipe the API's real figure.
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
	// The store is read on every persist run: it is both the replay source and the
	// only place an api-tier figure survives a keyless run.
	const stored = persist ? await readLastGood() : undefined;
	const migration = persist ? await importMpcStore(models, stored) : undefined;
	if (migration) {
		notes.push(migration.note);
		// A degraded run writes no live data, but repairing the fallback is not live
		// data: it must survive, or the next run redoes the import and repeats the note.
		if (migration.repaired && live.degraded && stored) {
			await writeLastGood(stored.models, { fetchedAt: stored.fetchedAt });
		}
	}
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
	} else if (stored) {
		models = mergeStore(models, stored.models);
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
			// The migration note belongs to the run that performed it; a cached replay
			// of the same catalogue is not a second migration and must not say so.
			await writeCache({
				models,
				sources: catalogue.sources,
				indexVersion: live.indexVersion,
				fetchedAt: catalogue.fetchedAt,
				notes: live.notes,
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
