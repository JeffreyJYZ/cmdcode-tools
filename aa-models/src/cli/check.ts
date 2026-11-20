import { cacheNote, inspectCache } from "#~/sources/cache.ts";
import { type Catalogue, loadCatalogue } from "#~/sources/index.ts";
import type { Options } from "./options.ts";

/** Per-source counts, plus the models no single source alone would explain. */
export interface SourceRow {
	name: string;
	count: number;
}

/** Every source named by the catalogue, with how many merged models carry it. */
export function sourceRows(models: Catalogue["models"], sources: string[]): SourceRow[] {
	const names = new Set<string>(sources);
	for (const model of models) for (const source of model.sources) names.add(source);
	return [...names].map((name) => ({
		name,
		count: models.filter((model) => model.sources.includes(name)).length,
	}));
}

/** Injectable so a test can validate `check` without touching the network. */
export interface CheckDeps {
	loadCatalogue?: typeof loadCatalogue;
}

/**
 * `aam check` validates sources, so it never uses the cache: the dispatched
 * catalogue may be a TTL hit or a last-good replay, and its counts would describe
 * the cache rather than the source. It reloads with the cache off and both stores
 * unwritable, then prints the state of the file a default run would serve, so a
 * difference carries a reason.
 *
 * The first parameter keeps `run.ts`'s `runCheck(catalogue, options)` dispatch
 * intact; a validation command must not trust it.
 */
export async function runCheck(
	_catalogue: Catalogue,
	options: Options,
	deps: CheckDeps = {},
): Promise<number> {
	const load = deps.loadCatalogue ?? loadCatalogue;
	let live: Catalogue;
	try {
		live = await load({
			apiKey: options.aaKey ?? process.env.AA_API_KEY,
			noApi: options.noApi,
			cacheTtlMs: 0,
			// Neither store may be touched: this reload exists to describe the
			// stores a default run would read, not to repair them.
			noCacheWrite: true,
		});
	} catch (error) {
		console.error(`aam: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}

	const cache = await inspectCache(options.cacheMs);
	const rows = sourceRows(live.models, live.sources);
	const scored = live.models.filter((model) => model.intelligenceIndex !== null).length;
	const ok = live.models.length > 0;
	const notes = [...live.notes, cacheNote(cache)];
	if (options.format === "json") {
		console.log(
			JSON.stringify(
				{
					schema: "aa-models/1",
					sources: rows,
					indexVersion: live.indexVersion,
					fetchedAt: live.fetchedAt,
					stale: live.stale,
					notes,
					total: live.models.length,
					scored,
					ok,
				},
				null,
				"\t",
			),
		);
		return ok ? 0 : 1;
	}
	for (const row of rows) console.log(`${row.name.padEnd(12)} ${row.count} models`);
	if (rows.length === 0) console.log("no source answered");
	if (live.indexVersion !== null) console.log(`index version  ${live.indexVersion}`);
	console.log(`coverage       ${scored} scored / ${live.models.length} total`);
	console.log(cacheNote(cache));
	for (const note of live.notes) console.log(`note: ${note}`);
	if (!ok) console.error("aam: no source produced a model");
	return ok ? 0 : 1;
}
