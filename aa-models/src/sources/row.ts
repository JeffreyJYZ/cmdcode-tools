/**
 * Reading scalars out of one upstream AA row.
 *
 * Every parser normalizes the same kinds of record — the API's flat rows, the
 * leaderboard's chart rows, the models page's nested ones — so these guards are
 * the one place that decides what "published" means: absent, null and 0 are not
 * values, and a nested scalar is found by its own key.
 */
export type Rec = Record<string, unknown>;

export const asRecord = (value: unknown): Rec | null =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
export const asString = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);
export const positive = (value: unknown): number | null =>
	finite(value) && value > 0 ? value : null;
export function dig(value: unknown, pattern: RegExp): number | null {
	const rec = asRecord(value);
	if (!rec) return null;
	for (const [key, child] of Object.entries(rec)) {
		if (pattern.test(key) && finite(child)) return child;
	}
	for (const child of Object.values(rec)) {
		const found = dig(child, pattern);
		if (found !== null) return found;
	}
	return null;
}

/** Top-level fields already modelled elsewhere, never duplicated into `evals`. */
const CONSUMED =
	/^(slug|shortName|suffix|releaseDate|isReasoning|isOpenWeights|contextWindowTokens|intelligenceIndex|outputSpeed|timeToFirstToken|price1mInputTokens|price1mOutputTokens|price1mBlended0To3To1)$/;
export function walkEvals(value: unknown, prefix: string, out: Record<string, number>): void {
	const rec = asRecord(value);
	if (!rec) return;
	for (const [key, child] of Object.entries(rec)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (finite(child)) {
			if (!CONSUMED.test(path)) out[path] = child;
		} else if (child && typeof child === "object" && !Array.isArray(child)) {
			walkEvals(child, path, out);
		}
	}
}
