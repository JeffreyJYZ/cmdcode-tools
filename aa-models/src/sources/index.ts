import type { Model } from "#~/model.ts";
import { loadAaApi } from "./api.ts";
import { readCache, writeCache } from "./cache.ts";
import { ageLabel, readLastGood, writeLastGood } from "./lastGood.ts";
import { loadLeaderboard } from "./leaderboard.ts";
import { type SourceResult, mergeModels } from "./normalize.ts";

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
	 * Leave both stores untouched: no TTL cache, no last-good rewrite. `aam check`
	 * sets it on the dispatch load so a poisoned cache is still there when the
	 * command reports on it — a diagnostic must not repair what it diagnoses.
	 */
	noCacheWrite?: boolean;
}

export interface Catalogue {
	models: Model[];
	/** Which loaders answered, e.g. ["manifest", "leaderboard"]. */
	sources: string[];
	indexVersion: string | null;
	fetchedAt: string;
	/** True when this came from the last-good fallback rather than a live fetch. */
	stale: boolean;
	/** Non-fatal problems, one line each, for the footer and `--json`. */
	notes: string[];
}

const SOURCE_ORDER = ["manifest", "leaderboard", "models", "api"];

/**
 * The one entry point: manifest leads (lane B), the keyless pages fill index,
 * speed, price and context, then the API when a key exists. Every source fails
 * soft into `notes`; only a total failure throws, naming the endpoints.
 */
export async function loadCatalogue(options: LoadOptions): Promise<Catalogue> {
	const ttl = options.cacheTtlMs;
	const persist = options.noCacheWrite !== true;
	if (ttl > 0 && !options.refresh) {
		const cached = await readCache(ttl);
		if (cached) return { ...cached, stale: false };
	}

	const notes: string[] = [];
	const groups: Model[][] = [];
	const manifest = await loadManifest();
	if (manifest?.models.length) groups.push(manifest.models);
	if (manifest) notes.push(...manifest.notes);

	try {
		const web = await loadLeaderboard();
		groups.push(web.models);
		notes.push(...web.notes);
	} catch (error) {
		notes.push(`leaderboard: ${reason(error)}`);
	}

	let indexVersion: string | null = null;
	if (options.apiKey && !options.noApi) {
		try {
			const api = await loadAaApi(options.apiKey);
			if (api.models.length > 0) groups.push(api.models);
			notes.push(...api.notes);
			indexVersion = api.indexVersion;
		} catch (error) {
			notes.push(`api: ${reason(error)}`);
		}
	}

	const models = mergeModels(groups);
	if (models.length === 0) {
		const last = await readLastGood();
		if (!last) throw new Error(notes.join("; ") || "every source failed");
		return {
			models: last.models,
			sources: sourcesOf(last.models),
			indexVersion: null,
			fetchedAt: new Date(last.fetchedAt).toISOString(),
			stale: true,
			notes: [...notes, `last good, ${ageLabel(Date.now() - last.fetchedAt)} old`],
		};
	}

	const catalogue: Catalogue = {
		models,
		sources: sourcesOf(models),
		indexVersion,
		fetchedAt: new Date().toISOString(),
		stale: false,
		notes,
	};
	if (persist) await writeLastGood(models);
	if (persist && ttl > 0) {
		await writeCache({
			models,
			sources: catalogue.sources,
			indexVersion,
			fetchedAt: catalogue.fetchedAt,
			notes,
		});
	}
	return catalogue;
}

/**
 * Lane B owns the manifest loader. Resolved lazily so this module compiles and
 * runs before it lands: absence is a note, never a crash.
 */
async function loadManifest(): Promise<SourceResult | null> {
	const specifier = "./manifest.ts";
	try {
		const mod = (await import(specifier)) as { loadManifest?: () => Promise<SourceResult> };
		if (typeof mod.loadManifest !== "function") {
			return { models: [], notes: ["manifest: loader absent"] };
		}
		return await mod.loadManifest();
	} catch (error) {
		return { models: [], notes: [`manifest: ${reason(error)}`] };
	}
}

function sourcesOf(models: Model[]): string[] {
	const seen = new Set(models.flatMap((model) => model.sources));
	const ordered = SOURCE_ORDER.filter((source) => seen.has(source));
	for (const source of seen) if (!ordered.includes(source)) ordered.push(source);
	return ordered;
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
