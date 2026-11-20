import type { Model } from "#~/model.ts";

export interface SourceResult {
	models: Model[];
	notes: string[];
}

type Rec = Record<string, unknown>;

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
/** AA's modality flags. Text is implied whenever the row lists any flag for a side. */
export function modalitiesOf(row: Rec): Model["modalities"] {
	const pick = (side: "input" | "output"): string[] => {
		const names = ["Text", "Image", "Speech", "Video"] as const;
		const flags = names.filter((name) => typeof row[`${side}Modality${name}`] === "boolean");
		if (flags.length === 0) return [];
		// Language models take text unless a flag says otherwise, so text leads.
		const out = ["text"];
		for (const name of flags) {
			if (name !== "Text" && row[`${side}Modality${name}`] === true)
				out.push(name.toLowerCase());
		}
		return out;
	};
	return { input: pick("input"), output: pick("output") };
}
export function creatorOf(row: Rec): string | null {
	return (
		asString(row.modelCreatorName) ??
		asString(row.creator) ??
		asString(asRecord(row.creator)?.name)
	);
}

export function priceOf(row: Rec): Model["price"] {
	const input =
		positive(row.price1mInputTokens) ?? positive(dig(row, /price_1m_input|price.*input/i));
	const output =
		positive(row.price1mOutputTokens) ?? positive(dig(row, /price_1m_output|price.*output/i));
	const blended = positive(row.price1mBlended0To3To1) ?? positive(dig(row, /blended/i));
	if (input === null && output === null && blended === null) return null;
	return { input, output, blended };
}

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];
const higher = (a: number | null, b: number | null): number | null =>
	a === null ? b : b === null ? a : Math.max(a, b);
export function mergeModels(groups: Model[][]): Model[] {
	const out: Model[] = [];
	const bySlug = new Map<string, Model>();
	const byKey = new Map<string, Model>();
	for (const model of groups.flat()) {
		const exact = bySlug.get(model.slug);
		const keyed = exact ? undefined : model.keys.map((key) => byKey.get(key)).find(Boolean);
		// A shared join key attaches another source's figures; it never folds two
		// rows one source already listed apart (AA lists every dated build).
		const found = exact ?? (keyed && !sharesSource(keyed, model) ? keyed : undefined);
		const target = found ?? { ...model, keys: [...model.keys], sources: [...model.sources] };
		if (found) absorb(found, model);
		else out.push(target);
		bySlug.set(target.slug, target);
		for (const key of union(target.keys, model.keys)) {
			if (!byKey.has(key)) byKey.set(key, target);
		}
	}
	return out;
}
const sharesSource = (a: Model, b: Model): boolean =>
	a.sources.some((source) => b.sources.includes(source));

function absorb(into: Model, from: Model): void {
	into.intelligenceIndex = higher(into.intelligenceIndex, from.intelligenceIndex);
	into.outputSpeed = higher(into.outputSpeed, from.outputSpeed);
	into.latency ??= from.latency;
	into.contextWindow ??= from.contextWindow;
	into.maxOutputTokens ??= from.maxOutputTokens;
	into.shortName ??= from.shortName;
	into.creator ??= from.creator;
	into.openWeights ??= from.openWeights;
	into.release = {
		slug: into.release.slug ?? from.release.slug,
		name: into.release.name ?? from.release.name,
		date: into.release.date ?? from.release.date,
	};
	into.price =
		into.price && from.price
			? {
					input: into.price.input ?? from.price.input,
					output: into.price.output ?? from.price.output,
					blended: into.price.blended ?? from.price.blended,
				}
			: (into.price ?? from.price);
	into.modalities = {
		input: union(into.modalities.input, from.modalities.input),
		output: union(into.modalities.output, from.modalities.output),
	};
	into.reasoning = {
		supported: into.reasoning.supported ?? from.reasoning.supported,
		efforts: union(into.reasoning.efforts, from.reasoning.efforts),
	};
	for (const [path, value] of Object.entries(from.evals)) {
		if (!(path in into.evals)) into.evals[path] = value;
	}
	const seen = new Set(into.variants.map((variant) => `${variant.slug}|${variant.label ?? ""}`));
	for (const variant of from.variants) {
		const id = `${variant.slug}|${variant.label ?? ""}`;
		if (!seen.has(id)) {
			seen.add(id);
			into.variants.push(variant);
		}
	}
	into.keys = union(into.keys, from.keys);
	into.sources = union(into.sources, from.sources);
	if (into.raw === undefined) into.raw = from.raw;
}
