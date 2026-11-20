import type { Model } from "#~/model.ts";
import { loadAaApi } from "./api.ts";
import { loadLeaderboard } from "./leaderboard.ts";
import type { SourceResult } from "./normalize.ts";

/** Everything the live sources answered, plus what they could not. */
export interface LiveLoad {
	/** One group per source that answered, the manifest first for identity. */
	groups: Model[][];
	notes: string[];
	indexVersion: string | null;
	/** A source that should have answered did not, so the run is partial. */
	degraded: boolean;
}

export interface CollectOptions {
	/** AA API key; absent means keyless sources only. */
	apiKey?: string;
	/** Skip the API even when a key exists. */
	noApi?: boolean;
}

/**
 * Fetch every source, failing soft: a dead source costs a note plus `degraded`,
 * never the catalogue. The manifest leads because its slugs name the models; the
 * order decides identity only, since `mergeModels` ranks `outputSpeed` by the
 * field it came from rather than by which source answered first.
 */
export async function collectSources(options: CollectOptions): Promise<LiveLoad> {
	const groups: Model[][] = [];
	const notes: string[] = [];
	let indexVersion: string | null = null;
	let degraded = false;
	const record = (result: SourceResult, source: string): void => {
		if (result.models.length === 0) {
			degraded = true;
			notes.push(`${source}: no models`);
		}
		if (result.notes.length > 0) degraded = true;
		groups.push(result.models);
		notes.push(...result.notes);
	};

	record(await loadManifest(), "manifest");
	try {
		record(await loadLeaderboard(), "leaderboard");
	} catch (error) {
		degraded = true;
		notes.push(`leaderboard: ${reason(error)}`);
	}
	if (options.apiKey && !options.noApi) {
		try {
			const api = await loadAaApi(options.apiKey);
			record(api, "api");
			indexVersion = api.indexVersion;
		} catch (error) {
			degraded = true;
			notes.push(`api: ${reason(error)}`);
		}
	}
	return { groups, notes, indexVersion, degraded };
}

/**
 * Lane B owns the manifest loader. Resolved lazily so this module compiles and
 * runs before it lands: absence is a note, never a crash.
 */
async function loadManifest(): Promise<SourceResult> {
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

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
