import type { Model } from "#~/model.ts";
import { type Rec, asRecord, asString, dig, positive } from "./row.ts";
import { takeSpeed } from "./speed.ts";

export interface SourceResult {
	models: Model[];
	notes: string[];
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

/**
 * Highest score leads the model; every other row of the same release becomes a
 * labelled variant, so a variant's speed never lands on the lead by itself.
 */
export function collapse(group: Array<{ model: Model; rowSlug: string }>): Model[] {
	if (group.length === 1) return group.flatMap(({ model }) => [model]);
	const rank = (model: Model) => model.intelligenceIndex ?? Number.NEGATIVE_INFINITY;
	const [first, ...rest] = [...group].sort(
		(a, b) =>
			rank(b.model) - rank(a.model) ||
			(b.model.outputSpeed ?? 0) - (a.model.outputSpeed ?? 0),
	);
	if (!first) return [];
	const efforts = new Set(group.flatMap(({ model }) => model.reasoning.efforts));
	return [
		{
			...first.model,
			reasoning: { ...first.model.reasoning, efforts: [...efforts] },
			variants: [first, ...rest].slice(1).map(({ model, rowSlug }) => ({
				slug: rowSlug,
				label: model.reasoning.efforts[0] ?? null,
				intelligenceIndex: model.intelligenceIndex,
				outputSpeed: model.outputSpeed,
			})),
		},
	];
}

/**
 * Merge groups into one model per release. `outputSpeed` keeps the better-ranked
 * field rather than the larger number, so the API's documented median is never
 * displaced by a page chart aggregate. `gaps` replays a last-good catalogue: the
 * live figure always wins the score, and only that.
 */ export function mergeModels(groups: Model[][], gaps = false): Model[] {
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
		if (found) absorb(found, model, gaps);
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

function absorb(into: Model, from: Model, gaps: boolean): void {
	into.intelligenceIndex = gaps
		? (into.intelligenceIndex ?? from.intelligenceIndex)
		: higher(into.intelligenceIndex, from.intelligenceIndex);
	takeSpeed(into, from);
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
