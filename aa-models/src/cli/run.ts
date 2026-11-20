import { applyFilters, type FilterQuery } from "#~/filter.ts";
import { sortModels } from "#~/sort.ts";
import { loadCatalogue, type Catalogue, type LoadOptions } from "#~/sources/index.ts";
import { columnHelp } from "#~/view/help.ts";
import { runCheck, runFields, runModel } from "./commands.ts";
import type { Options } from "./options.ts";
import { envelope, renderRows } from "./output.ts";
import { parseArgv } from "./parse.ts";
import { toOptions } from "./map.ts";

/** Only the flags the user set; an explicit `undefined` would read as a filter. */
function filterQuery(options: Options, modelPattern = options.model): FilterQuery {
	const query: FilterQuery = {};
	if (modelPattern !== undefined) query.model = modelPattern;
	if (options.creators !== undefined) query.creator = options.creators.join(",");
	if (options.where.length > 0) query.where = options.where;
	if (options.scored) query.scored = true;
	if (options.unscored) query.unscored = true;
	if (options.minIntel !== undefined) query.minIntel = options.minIntel;
	if (options.maxIntel !== undefined) query.maxIntel = options.maxIntel;
	if (options.minTps !== undefined) query.minTps = options.minTps;
	if (options.maxTps !== undefined) query.maxTps = options.maxTps;
	if (options.minContext !== undefined) query.minContext = options.minContext;
	if (options.openWeights) query.openWeights = true;
	if (options.closedWeights) query.closedWeights = true;
	if (options.since !== undefined) query.since = options.since;
	return query;
}

function loadOptions(options: Options, apiKey: string | undefined): LoadOptions {
	return {
		apiKey,
		noApi: options.noApi,
		refresh: options.refresh,
		cacheTtlMs: options.cacheMs,
		// `check` reloads with its own cache-less load and then reports the file a
		// default run would read, so this dispatch must not rewrite it first: a
		// poisoned cache has to still be poisoned when the command describes it.
		noCacheWrite: options.command === "check",
	};
}

/** Injectable only so tests can supply a catalogue without touching the network. */
export interface Deps {
	loadCatalogue?: typeof loadCatalogue;
}

export async function run(argv: string[], deps: Deps = {}): Promise<number> {
	const parsed = parseArgv(argv);
	// cac does not exit on --help/--version; it prints and returns.
	if (parsed.help || parsed.version) return 0;
	const options = toOptions(parsed);
	if (options.columnsHelp) {
		console.log(columnHelp());
		return 0;
	}
	// No config file in v1: the key comes from the flag, then the environment.
	const apiKey = options.aaKey ?? process.env.AA_API_KEY;
	const loader = deps.loadCatalogue ?? loadCatalogue;
	const catalogue = await loader(loadOptions(options, apiKey));

	if (options.command === "check") return runCheck(catalogue, options);
	if (options.command === "fields") return runFields(catalogue, options);

	const pattern = options.command === "model" ? options.query : options.model;
	const filtered: ReturnType<typeof applyFilters> = applyFilters(
		catalogue.models,
		filterQuery(options, pattern),
	);
	const models = sortModels(filtered.models, options.sort, options.asc);
	const withNotes: Catalogue = {
		...catalogue,
		notes: [...catalogue.notes, ...filtered.notes],
	};

	if (options.command === "model") return runModel(withNotes, options, models);
	if (options.format === "json") {
		console.log(JSON.stringify(envelope(withNotes, models, options), null, "\t"));
		return 0;
	}
	console.log(renderRows(withNotes, models, options));
	return 0;
}
