import { AA_LEADERBOARD_URL, AA_MODELS_URL } from "#~/constants/sources.ts";
import { type BenchData, emptyData } from "#~/data/bench/types.ts";
import { normalizeKey } from "#~/keys.ts";
import { decodeFlight, readArray } from "./flight.ts";
import { parseAaLeaderboard } from "./leaderboard.ts";

/** The subset of an AA models-page record this parser reads. */
interface AaModel {
	slug?: unknown;
	name?: unknown;
	shortName?: unknown;
	intelligenceIndex?: unknown;
	timescaleData?: { medianOutputSpeed?: unknown } | null;
}

/** A finite, positive number; `null` for anything else (incl. 0 = unmeasured). */
function positive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function labelOf(model: AaModel): string {
	if (typeof model.name === "string") return model.name;
	return typeof model.shortName === "string" ? model.shortName : "";
}

function keyOf(value: unknown): string {
	return typeof value === "string" ? normalizeKey(value) : "";
}

/**
 * Pure parser over the AA models page. Keyless and live: the page embeds its
 * `initialModels` array in the RSC flight payload, each record carrying the
 * Intelligence Index and (mostly) a median output speed. Only that embedded
 * top-N is covered, so this is a partial source.
 */
export function parseAaWeb(html: string): BenchData {
	const data = emptyData();
	const models = readArray(decodeFlight(html) || html, "initialModels");
	if (!models) return data;
	for (const raw of models) {
		const model = (raw ?? {}) as AaModel;
		// slug is the precise key; the display name is the fallback.
		const keys = [keyOf(model.slug), keyOf(labelOf(model))].filter(Boolean);
		const score = positive(model.intelligenceIndex);
		const speed = positive(model.timescaleData?.medianOutputSpeed);
		for (const key of keys) {
			if (score !== null && !data.intelligence.has(key)) {
				data.intelligence.set(key, score);
			}
			if (speed !== null && !data.tps.has(key)) data.tps.set(key, speed);
		}
	}
	return data;
}

/** Bounded fetch: a stalled AA page must never hold a whole run. */
async function fetchBounded(url: string): Promise<string> {
	const res = await fetch(url, {
		headers: { "user-agent": "mpc/0.1 (+model price compare)" },
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
	return res.text();
}

/**
 * Live keyless AA scrape. The leaderboard carries far more rows than /models,
 * so it leads; the models page is merged in as a fallback. Best value per key
 * wins, and a score from either source never masks a higher one from the other.
 * Two bounded requests, every run — nothing cached.
 */
export async function loadAaWeb(): Promise<BenchData> {
	const [leaderboardHtml, modelsHtml] = await Promise.all([
		fetchBounded(AA_LEADERBOARD_URL),
		fetchBounded(AA_MODELS_URL),
	]);
	const data = parseAaLeaderboard(leaderboardHtml);
	const fallback = parseAaWeb(modelsHtml);
	for (const [key, score] of fallback.intelligence) {
		if (score > (data.intelligence.get(key) ?? 0)) data.intelligence.set(key, score);
	}
	for (const [key, speed] of fallback.tps) {
		if (speed > (data.tps.get(key) ?? 0)) data.tps.set(key, speed);
	}
	return data;
}
