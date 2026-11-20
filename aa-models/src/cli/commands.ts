import type { Model } from "#~/model.ts";
import type { Catalogue } from "#~/sources/index.ts";
import { renderRecord } from "./output.ts";
import type { Options } from "./options.ts";

/** `aa check` lives in its own module; `run.ts` still imports it from here. */
export { type CheckDeps, runCheck, sourceRows } from "./check.ts";

/** `aa model` — exact slug, then exact key, then the same filter every list uses. */
export function runModel(catalogue: Catalogue, options: Options, matches: Model[]): number {
	const query = (options.query ?? "").toLowerCase();
	const bySlug = catalogue.models.filter((model) => model.slug.toLowerCase() === query);
	const byKey = catalogue.models.filter((model) =>
		model.keys.some((key) => key.toLowerCase() === query),
	);
	const exact = bySlug.length > 0 ? bySlug : byKey;
	const found = exact.length > 0 ? exact : matches;
	if (found.length === 0) {
		console.error(`aa: no model matches "${options.query}"`);
		return 1;
	}
	if (found.length > 1) {
		console.error(`aa: "${options.query}" matches ${found.length} models — narrow it:`);
		for (const model of found) console.error(`  ${model.slug}  ${model.name}`);
		return 1;
	}
	const model = found[0] as Model;
	if (options.format === "json") {
		console.log(JSON.stringify(options.raw ? model : stripRaw(model), null, "\t"));
		return 0;
	}
	console.log(renderRecord(model));
	return 0;
}

function stripRaw(model: Model): Model {
	const { raw: _raw, ...rest } = model;
	return rest;
}

interface FieldRow {
	path: string;
	count: number;
}

/** Every scalar/array dot-path across the catalogue, with its model count. */
export function fieldRows(models: Model[]): FieldRow[] {
	const counts = new Map<string, number>();
	for (const model of models) {
		const seen = new Set<string>();
		walk(model, "", seen);
		for (const path of seen) counts.set(path, (counts.get(path) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([path, count]) => ({ path, count }))
		.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

function walk(value: unknown, prefix: string, out: Set<string>): void {
	if (value === null || value === undefined || value === "") return;
	if (typeof value === "object") {
		if (Array.isArray(value)) {
			if (prefix !== "" && value.length > 0) out.add(prefix);
			return;
		}
		for (const [key, child] of Object.entries(value)) {
			if (key === "raw") continue;
			walk(child, prefix === "" ? key : `${prefix}.${key}`, out);
		}
		return;
	}
	if (prefix !== "") out.add(prefix);
}

export function runFields(catalogue: Catalogue, options: Options): number {
	const rows = fieldRows(catalogue.models);
	if (options.format === "json") {
		console.log(
			JSON.stringify(
				{
					schema: "aa-models/1",
					sources: catalogue.sources,
					indexVersion: catalogue.indexVersion,
					fetchedAt: catalogue.fetchedAt,
					stale: catalogue.stale,
					notes: catalogue.notes,
					total: catalogue.models.length,
					fields: rows,
				},
				null,
				"\t",
			),
		);
		return 0;
	}
	const width = Math.max(...rows.map((row) => row.path.length), 4);
	for (const row of rows) console.log(`${row.path.padEnd(width)}  ${row.count}`);
	console.log(
		`\n${rows.length} fields across ${catalogue.models.length} models · ${catalogue.sources.join(" + ")}`,
	);
	return 0;
}
