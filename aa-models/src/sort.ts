import type { Model } from "#~/model.ts";
import { isMissing, resolvePath } from "#~/where.ts";

/** Named sort fields, so `--sort tps` and `--sort outputSpeed` agree. */
export const SORT_ALIASES: Record<string, string> = {
	intelligence: "intelligenceIndex",
	intel: "intelligenceIndex",
	tps: "outputSpeed",
	speed: "outputSpeed",
	context: "contextWindow",
	price: "price.blended",
	released: "release.date",
	date: "release.date",
	name: "name",
	slug: "slug",
	creator: "creator",
	latency: "latency",
	maxoutput: "maxOutputTokens",
};

/** Intelligence descending: the contract's default. */
export const DEFAULT_SORT_FIELD = "intelligenceIndex";
export const DEFAULT_SORT_ASC = false;

/** Resolve an alias to the record's own path; an unknown field passes through. */
export function resolveSortField(field: string): string {
	return SORT_ALIASES[field] ?? field;
}

function comparable(value: unknown): string | number {
	if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
	if (typeof value === "number") return value;
	if (typeof value === "boolean") return value ? 1 : 0;
	return String(value);
}

function compare(a: unknown, b: unknown): number {
	const left = comparable(a);
	const right = comparable(b);
	if (typeof left === "number" && typeof right === "number") {
		if (left === right) return 0;
		return left < right ? -1 : 1;
	}
	const l = String(left);
	const r = String(right);
	if (l === r) return 0;
	return l < r ? -1 : 1;
}

/**
 * Sort by a dot-path or alias. A missing value is always last, whichever way the
 * direction points, so `--asc` cannot float unscored models to the top. Ties break
 * on name then slug, which keeps repeated runs byte-identical.
 */
export function sortModels(
	models: Model[],
	field: string = DEFAULT_SORT_FIELD,
	asc: boolean = DEFAULT_SORT_ASC,
): Model[] {
	const path = resolveSortField(field);
	const direction = asc ? 1 : -1;
	return [...models].sort((a, b) => {
		const av = resolvePath(a, path);
		const bv = resolvePath(b, path);
		const aMissing = isMissing(av);
		const bMissing = isMissing(bv);
		if (aMissing !== bMissing) return aMissing ? 1 : -1;
		if (!aMissing && !bMissing) {
			const result = compare(av, bv);
			if (result !== 0) return result * direction;
		}
		return tiebreak(a, b);
	});
}

function tiebreak(a: Model, b: Model): number {
	const byName = compare(a.name.toLowerCase(), b.name.toLowerCase());
	if (byName !== 0) return byName;
	return compare(a.slug, b.slug);
}
