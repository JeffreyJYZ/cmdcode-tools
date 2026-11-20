import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Model } from "#~/model.ts";
import { ageLabel, cacheDir, writeJson } from "./lastGood.ts";

/**
 * The identity a cache file carries.
 *
 * Bump `LOADER_REVISION` by hand whenever the merge in `normalize.ts` or any
 * parser's output changes. A cache has no other proof of what wrote it, so
 * without it a fixed merge silently serves the old, wrong catalogue for a whole
 * TTL — which is how a repaired key-merge kept serving 384 models. `CACHE_SCHEMA`
 * moves only when this payload's own fields change.
 */
export const LOADER_REVISION = "1";
export const CACHE_SCHEMA = "aa-models/2";

/** The catalogue as it lands on disk. `stale` is never persisted. */
export interface StoredCatalogue {
	models: Model[];
	sources: string[];
	indexVersion: string | null;
	fetchedAt: string;
	notes: string[];
}

interface CacheFile extends StoredCatalogue {
	schema: string;
	revision: string;
	version: string;
}

/**
 * What `aa check` reports about the file a default run would read.
 * `usable` is true only when that run would actually serve this file.
 */
export interface CacheState {
	path: string;
	present: boolean;
	ageMs: number | null;
	revision: string | null;
	version: string | null;
	usable: boolean;
	reason: string;
}

export function cachePath(): string {
	return join(cacheDir(), "catalogue.json");
}

/** A missing or unparsable file is `null`, never a throw: a run must not differ. */
async function readCacheFile(): Promise<Partial<CacheFile> | null> {
	try {
		return JSON.parse(await readFile(cachePath(), "utf8")) as Partial<CacheFile>;
	} catch {
		return null;
	}
}

/** The one verdict every reader shares, so read and report cannot disagree. */
function verdict(file: Partial<CacheFile> | null, ttl: number): CacheState {
	const path = cachePath();
	if (file === null) {
		return {
			path,
			present: false,
			ageMs: null,
			revision: null,
			version: null,
			usable: false,
			reason: "no cache file yet",
		};
	}
	const fetched = typeof file.fetchedAt === "string" ? Date.parse(file.fetchedAt) : Number.NaN;
	const ageMs = Number.isFinite(fetched) ? Date.now() - fetched : null;
	const revision = typeof file.revision === "string" ? file.revision : null;
	const version = typeof file.version === "string" ? file.version : null;
	const models = Array.isArray(file.models) ? file.models.length : 0;
	const state: CacheState = {
		path,
		present: true,
		ageMs,
		revision,
		version,
		usable: false,
		reason: "",
	};
	if (file.schema !== CACHE_SCHEMA) {
		return { ...state, reason: `schema ${file.schema ?? "none"} (current ${CACHE_SCHEMA})` };
	}
	if (revision !== LOADER_REVISION) {
		return { ...state, reason: `revision ${revision ?? "none"} (current ${LOADER_REVISION})` };
	}
	if (models === 0) return { ...state, reason: "carries no models" };
	if (ageMs === null) return { ...state, reason: "unreadable fetchedAt" };
	if (ttl === 0) return { ...state, reason: "cache is off (--cache 0)" };
	if (ageMs >= ttl) return { ...state, reason: `older than the TTL (${ageLabel(ageMs)})` };
	return { ...state, usable: true, reason: "served" };
}

/** What `aa check` prints: the file a default run would read, and whether it would. */
export async function inspectCache(ttl: number): Promise<CacheState> {
	return verdict(await readCacheFile(), ttl);
}

/**
 * The TTL cache: today's live catalogue, never an empty one. A file written by a
 * different build is ignored and overwritten, never migrated.
 */
export async function readCache(ttl: number): Promise<StoredCatalogue | null> {
	const file = await readCacheFile();
	if (file === null) return null;
	const state = verdict(file, ttl);
	if (!state.usable) return null;
	const {
		schema: _schema,
		revision: _revision,
		version: _version,
		...stored
	} = file as CacheFile;
	const notes = Array.isArray(stored.notes) ? stored.notes : [];
	return {
		...stored,
		notes: [
			...notes,
			`cache: ${stored.models.length} models, ${ageLabel(state.ageMs ?? 0)} old`,
		],
	};
}

export async function writeCache(catalogue: StoredCatalogue): Promise<void> {
	if (catalogue.models.length === 0) return; // never persist an empty catalogue
	await writeJson("catalogue.json", {
		schema: CACHE_SCHEMA,
		revision: LOADER_REVISION,
		version: pkg.version,
		...catalogue,
	});
}

/** The cache line `aa check` prints, so a default run's numbers have a reason. */
export function cacheNote(state: CacheState): string {
	if (!state.present) return `cache: ${state.path} · nothing written yet`;
	const age = ageLabel(state.ageMs ?? 0);
	if (state.usable)
		return `cache: ${state.path} · ${age} old · revision ${state.revision} · served`;
	return `cache: ${state.path} · ${age} old · ${state.reason} · ignored`;
}
