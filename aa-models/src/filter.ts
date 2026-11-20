import type { Model } from "#~/model.ts";
import { isMissing, matchesWhere, parseWhere, resolvePath } from "#~/where.ts";

/** Every filter flag the CLI surface allows. All optional; absent means no clause. */
export interface FilterQuery {
	/** `--model <re>`: case-insensitive regex, substring fallback, over name/slug/keys. */
	model?: string;
	/** `--creator a,b`: comma-separated, case-insensitive exact match. */
	creator?: string;
	/** `--where "path op value"`, repeatable. All clauses AND. */
	where?: string[];
	/** `--scored` keeps measured models. */
	scored?: boolean;
	/** `--unscored` keeps the models AA lists without a score. */
	unscored?: boolean;
	/** `--open-weights`: tri-state, `null` fails. */
	openWeights?: boolean;
	/** `--closed-weights`: tri-state, `null` fails. */
	closedWeights?: boolean;
	minIntel?: number;
	maxIntel?: number;
	minTps?: number;
	maxTps?: number;
	minContext?: number;
	/** `--since <YYYY-MM-DD>`: release date on or after this day. */
	since?: string;
}

export interface FilterResult {
	models: Model[];
	/** One line per problem the user should see: a typo'd path, an unusable clause. */
	notes: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function applyFilters(models: Model[], query: FilterQuery): FilterResult {
	if (query.scored === true && query.unscored === true) {
		throw new Error("--scored and --unscored cannot be combined");
	}
	const notes: string[] = [];
	const clauses: Array<(model: Model) => boolean> = [];

	if (query.model) clauses.push(modelMatcher(query.model));
	if (query.creator) clauses.push(creatorMatcher(query.creator));
	if (query.scored === true) clauses.push((m) => m.intelligenceIndex !== null);
	if (query.unscored === true) clauses.push((m) => m.intelligenceIndex === null);
	if (query.openWeights === true) clauses.push((m) => m.openWeights === true);
	if (query.closedWeights === true) clauses.push((m) => m.openWeights === false);
	if (query.minIntel !== undefined) {
		clauses.push(bound((m) => m.intelligenceIndex, ">=", query.minIntel));
	}
	if (query.maxIntel !== undefined) {
		clauses.push(bound((m) => m.intelligenceIndex, "<=", query.maxIntel));
	}
	if (query.minTps !== undefined) clauses.push(bound((m) => m.outputSpeed, ">=", query.minTps));
	if (query.maxTps !== undefined) clauses.push(bound((m) => m.outputSpeed, "<=", query.maxTps));
	if (query.minContext !== undefined) {
		clauses.push(bound((m) => m.contextWindow, ">=", query.minContext));
	}

	if (query.since !== undefined) {
		const since = query.since;
		if (ISO_DATE.test(since)) {
			clauses.push((m) => typeof m.release.date === "string" && m.release.date >= since);
		} else {
			notes.push(`--since ${since}: expected YYYY-MM-DD, ignored`);
		}
	}

	for (const expr of query.where ?? []) {
		const clause = parseWhere(expr);
		if (!clause) {
			notes.push(`--where ${expr}: expected "path op value", ignored`);
			continue;
		}
		if (models.every((m) => isMissing(resolvePath(m, clause.path)))) {
			notes.push(`--where ${clause.path}: no model publishes this field`);
		}
		clauses.push((m) => matchesWhere(m, clause));
	}

	return { models: models.filter((m) => clauses.every((clause) => clause(m))), notes };
}

function modelMatcher(pattern: string): (model: Model) => boolean {
	const regex = compile(pattern);
	const needle = pattern.toLowerCase();
	return (model) => {
		const fields = [model.name, model.slug, ...model.keys];
		if (regex) return fields.some((field) => regex.test(field));
		return fields.some((field) => field.toLowerCase().includes(needle));
	};
}

/**
 * A pattern that will not compile is a typo, not a reason to return nothing:
 * drop trailing characters until it does, so `deepseek(` still finds DeepSeek.
 */
function compile(pattern: string): RegExp | null {
	let text = pattern;
	while (text.length > 0) {
		try {
			return new RegExp(text, "i");
		} catch {
			text = text.slice(0, -1);
		}
	}
	return null;
}

function creatorMatcher(list: string): (model: Model) => boolean {
	const wanted = new Set(
		list
			.split(",")
			.map((part) => part.trim().toLowerCase())
			.filter((part) => part !== ""),
	);
	return (model) => model.creator !== null && wanted.has(model.creator.toLowerCase());
}

function bound(
	get: (model: Model) => number | null,
	op: ">=" | "<=",
	limit: number,
): (model: Model) => boolean {
	return (model) => {
		const value = get(model);
		if (value === null || !Number.isFinite(value)) return false;
		return op === ">=" ? value >= limit : value <= limit;
	};
}
