import { AA_MODELS_URL } from "#~/constants/sources.ts";
import { fetchText } from "#~/data/scrape/index.ts";
import { normalizeKey } from "#~/keys.ts";

/** A model label and its Artificial Analysis Intelligence Index. */
interface Scored {
	label: string;
	slug?: string;
	score: number;
}

/** Every `{label, intelligenceIndex, detailsUrl}` the models page embeds. */
function parseEmbedded(html: string): Scored[] {
	const re =
		/"label":"([^"]+)","intelligenceIndex":([0-9.]+)(?:,"detailsUrl":"([^"]*)")?/g;
	const out: Scored[] = [];
	const seen = new Set<string>();
	for (let match = re.exec(html); match !== null; match = re.exec(html)) {
		const label = match[1] ?? "";
		const score = Number(match[2]);
		const slug = match[3]?.split("/").pop();
		const id = `${label}|${slug ?? ""}`;
		if (!label || !Number.isFinite(score) || seen.has(id)) continue;
		seen.add(id);
		out.push({ label, slug, score });
	}
	return out;
}

function toMap(scored: Scored[]): Map<string, number> {
	const scores = new Map<string, number>();
	for (const { label, slug, score } of scored) {
		// slug is the more precise key; label is the fallback.
		if (slug) scores.set(normalizeKey(slug), score);
		const labelKey = normalizeKey(label);
		if (labelKey && !scores.has(labelKey)) scores.set(labelKey, score);
	}
	return scores;
}

/** Keyless scrape of the Artificial Analysis models page. Only the models that
 * page embeds (its chart top-N) are covered, so this is a fallback, not a full
 * catalog.
 */
export async function loadAaWeb(): Promise<Map<string, number>> {
	const html = await fetchText(AA_MODELS_URL);
	return parseAaWeb(html);
}

/** Pure parser over the AA models page HTML, for tests and the scraper. */
export function parseAaWeb(html: string): Map<string, number> {
	return toMap(parseEmbedded(html));
}
