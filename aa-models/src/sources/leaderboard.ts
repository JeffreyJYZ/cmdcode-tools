import type { Model } from "#~/model.ts";
import { normalizeRows } from "#~/model.ts";
import { fetchText } from "./api.ts";
import { initialModels } from "./flight.ts";
import { type SourceResult, mergeModels } from "./normalize.ts";

export const LEADERBOARD_URL = "https://artificialanalysis.ai/leaderboards/models";
export const MODELS_URL = "https://artificialanalysis.ai/models";

/**
 * The leaderboard page's RSC `initialModels` array holds far more rows than
 * `/models` (287 vs 28 here), each scored row keyed on `release.slug` first.
 * Rows with a null index are listed but unmeasured; never coerce them to 0.
 */
export function parseLeaderboardHtml(html: string): Model[] {
	return normalizeRows(initialModels(html) ?? [], "leaderboard");
}

/**
 * The chart top-N on the models page: fewer rows, but the only keyless source
 * carrying context window, price, latency and modality flags.
 */
export function parseModelsHtml(html: string): Model[] {
	return normalizeRows(initialModels(html) ?? [], "models");
}

const PAGES: Array<[source: string, url: string, parse: (html: string) => Model[]]> = [
	["leaderboard", LEADERBOARD_URL, parseLeaderboardHtml],
	["models", MODELS_URL, parseModelsHtml],
];

/**
 * Both keyless pages, fetched together. One dead page is a note, not a blank
 * list; neither answering throws with the URLs, which is what `aa check` shows.
 */
export async function loadLeaderboard(): Promise<SourceResult> {
	const notes: string[] = [];
	const groups: Model[][] = [];
	const results = await Promise.allSettled(PAGES.map(([, url]) => fetchText(url)));
	for (const [index, result] of results.entries()) {
		const page = PAGES[index];
		if (!page) continue;
		const [source, url, parse] = page;
		if (result.status === "rejected") {
			notes.push(
				`${source}: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
			);
			continue;
		}
		const models = parse(result.value);
		if (models.length === 0) {
			notes.push(`${source}: 0 rows at ${url} (page payload lost its initialModels array)`);
			continue;
		}
		groups.push(models);
	}
	if (groups.length === 0) throw new Error(notes.join("; "));
	return { models: mergeModels(groups), notes };
}
