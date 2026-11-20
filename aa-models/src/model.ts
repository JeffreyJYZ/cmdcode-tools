import {
	asRecord,
	asString,
	creatorOf,
	dig,
	modalitiesOf,
	positive,
	priceOf,
	walkEvals,
} from "#~/sources/normalize.ts";
import { aaKeyVariants } from "#~/sources/keys.ts";

/** Release metadata as AA publishes it; every field stays null when absent. */
export interface Release {
	slug: string | null;
	name: string | null;
	/** ISO date (YYYY-MM-DD) when AA states one. */
	date: string | null;
}
export interface Model {
	slug: string;
	name: string;
	shortName: string | null;
	creator: string | null;
	release: Release;
	keys: string[];
	/** AA's Intelligence Index. null = listed but unmeasured, never 0 as a stand-in. */
	intelligenceIndex: number | null;
	outputSpeed: number | null;
	/** First-token latency in seconds, when published. */
	latency: number | null;
	contextWindow: number | null;
	maxOutputTokens: number | null;
	price: { input: number | null; output: number | null; blended: number | null } | null;
	openWeights: boolean | null;
	modalities: { input: string[]; output: string[] };
	reasoning: { supported: boolean | null; efforts: string[] };
	/** Every other finite scalar AA publishes, keyed by AA's own dot-joined path. */
	evals: Record<string, number>;
	variants: Array<{
		slug: string;
		label: string | null;
		intelligenceIndex: number | null;
		outputSpeed: number | null;
	}>;
	sources: string[];
	/** The untouched upstream record. Serializers drop it unless `--raw`. */
	raw?: unknown;
}

/** Turn one AA row into a `Model`; null when the row carries no identity at all. */
export function normalizeRow(raw: unknown, source: string): Model | null {
	const row = asRecord(raw);
	if (!row) return null;
	const release = asRecord(row.release);
	const slug = asString(release?.slug) ?? asString(row.slug);
	const name = asString(release?.name) ?? asString(row.name) ?? asString(row.shortName);
	if (!slug && !name) return null;
	const shortName = asString(row.shortName);
	const identity = slug ?? aaKeyVariants(name ?? "")[0] ?? "";
	if (!identity) return null;

	const keys = new Set<string>();
	// Effort labels ("high", "xhigh") are never join keys: every model has one and
	// they would merge unrelated models through a shared variant name.
	for (const value of [identity, slug, asString(row.slug), name, shortName]) {
		if (value) for (const key of aaKeyVariants(value)) keys.add(key);
	}

	const label = asString(asRecord(row.effort)?.label) ?? asString(row.suffix);
	const evals: Record<string, number> = {};
	walkEvals(row, "", evals);

	return {
		slug: identity,
		name: name ?? identity,
		shortName,
		creator: creatorOf(row),
		release: {
			slug: slug ?? null,
			name: asString(release?.name) ?? null,
			date: asString(row.releaseDate) ?? asString(row.release_date),
		},
		keys: [...keys],
		intelligenceIndex:
			positive(row.intelligenceIndex) ??
			positive(dig(row, /intelligence_index|intelligenceIndex/i)),
		outputSpeed:
			positive(row.outputSpeed) ??
			positive(dig(row, /median_output_tokens_per_second|output_speed|outputSpeed/i)),
		// AA's own value: seconds to the first visible token, so reasoning time counts
		// (equal to `timeToFirstAnswerToken`; 368.9 s on claude-opus-5-5 Max, not ms).
		latency:
			positive(row.timeToFirstToken) ??
			positive(dig(row, /time_to_first_token|timeToFirstToken/i)),
		contextWindow:
			positive(row.contextWindowTokens) ??
			positive(dig(row, /context_window|context_length|contextWindow/i)),
		maxOutputTokens: positive(dig(row, /max_output_tokens|maxOutputTokens/i)),
		price: priceOf(row),
		openWeights: typeof row.isOpenWeights === "boolean" ? row.isOpenWeights : null,
		modalities: modalitiesOf(row),
		reasoning: {
			supported: typeof row.isReasoning === "boolean" ? row.isReasoning : null,
			efforts: label ? [label] : [],
		},
		evals,
		variants: [],
		sources: [source],
		raw,
	};
}
/** Normalize a row list, folding effort variants that share one model slug. */
export function normalizeRows(rows: unknown[], source: string): Model[] {
	const groups = new Map<string, Array<{ model: Model; rowSlug: string }>>();
	for (const raw of rows) {
		const model = normalizeRow(raw, source);
		if (!model) continue;
		const rowSlug = asString(asRecord(raw)?.slug) ?? model.slug;
		const group = groups.get(model.slug) ?? [];
		group.push({ model, rowSlug });
		groups.set(model.slug, group);
	}
	return [...groups.values()].flatMap(collapse);
}

/** Highest score leads the model; every other row becomes a labelled variant. */
function collapse(group: Array<{ model: Model; rowSlug: string }>): Model[] {
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
