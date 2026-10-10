import { AA_MODELS_URL } from "#~/constants/sources.ts";
import { type BenchData, emptyData } from "#~/data/bench/types.ts";
import { fetchText } from "#~/data/scrape/index.ts";
import { normalizeKey } from "#~/keys.ts";

/** The subset of an AA models-page record this parser reads. */
interface AaModel {
	slug?: unknown;
	name?: unknown;
	shortName?: unknown;
	intelligenceIndex?: unknown;
	timescaleData?: { medianOutputSpeed?: unknown } | null;
}

/**
 * Decode a Next.js page's streamed RSC payload. Each chunk is a JSON string
 * literal inside `self.__next_f.push([1,"…"])`; joining the decoded strings
 * yields the flight text the page renders from, with plain `"initialModels":`
 * keys instead of the `\"`-escaped form seen in the raw HTML.
 */
function decodeFlight(html: string): string {
	const chunks: string[] = [];
	const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
	for (const match of html.matchAll(re)) {
		try {
			chunks.push(JSON.parse(match[1] ?? '""') as string);
		} catch {
			// A chunk we cannot read as a JSON string is skipped.
		}
	}
	return chunks.join("");
}

/** The JSON array value of `"key"` in `text`, bracket-matched string-aware. */
function readArray(text: string, key: string): unknown[] | null {
	const at = text.indexOf(`"${key}":`);
	if (at < 0) return null;
	const open = text.indexOf("[", at);
	if (open < 0) return null;
	let depth = 0;
	let inString = false;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (char === "\\") i++;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "[") depth++;
		else if (char === "]") {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(text.slice(open, i + 1)) as unknown[];
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

/** A finite, positive number; `null` for anything else (incl. 0 = unmeasured). */
function positive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: null;
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

/** Fetch and parse the AA models page. Live, per run — nothing cached. */
export async function loadAaWeb(): Promise<BenchData> {
	return parseAaWeb(await fetchText(AA_MODELS_URL));
}
