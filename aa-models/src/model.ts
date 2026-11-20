import { creatorOf, modalitiesOf, collapse, priceOf } from "#~/sources/normalize.ts";
import { asRecord, asString, dig, positive, walkEvals } from "#~/sources/row.ts";
import { aaKeyVariants } from "#~/sources/keys.ts";
import { type SpeedSource, readOutputSpeed } from "#~/sources/speed.ts";

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
	/**
	 * Median output tokens per second, from the declared field priority in
	 * `sources/speed.ts` — one series, never the max across two.
	 */
	outputSpeed: number | null;
	/**
	 * Which AA field produced `outputSpeed` (`api` | `page` | `timescale`): the
	 * merge keeps the better-ranked tier instead of the larger number.
	 */
	outputSpeedSource?: SpeedSource | null;
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
	const speed = readOutputSpeed(row);

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
		outputSpeed: speed?.value ?? null,
		outputSpeedSource: speed?.source ?? null,
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
