import type { Model } from "#~/model.ts";
import type { Catalogue } from "#~/sources/index.ts";
import { colorEnabled } from "#~/view/format.ts";
import { DEFAULT_COLUMNS, pickColumns } from "#~/view/columns.ts";
import { renderTable } from "#~/view/table.ts";
import type { Options } from "./options.ts";

/** The exact `--json` shape from the contract; key order is part of it. */
export interface Envelope {
	schema: "aa-models/1";
	sources: string[];
	indexVersion: string | null;
	fetchedAt: string;
	stale: boolean;
	notes: string[];
	total: number;
	count: number;
	models: Model[];
}

/** `raw` is opt-in in JSON only, so drop the key rather than leave it undefined. */
function keep(model: Model, raw: boolean): Model {
	if (raw) return model;
	const { raw: _raw, ...rest } = model;
	return rest;
}

export function envelope(catalogue: Catalogue, models: Model[], options: Options): Envelope {
	return {
		schema: "aa-models/1",
		sources: catalogue.sources,
		indexVersion: catalogue.indexVersion,
		fetchedAt: catalogue.fetchedAt,
		stale: catalogue.stale,
		notes: catalogue.notes,
		total: catalogue.models.length,
		count: models.length,
		models: models.map((model) => keep(model, options.raw)),
	};
}

/** Columns the machine formats and the table share; `--columns` wins when given. */
function chosenColumns(options: Options) {
	return options.columns.length > 0 ? pickColumns(options.columns) : pickColumns(DEFAULT_COLUMNS);
}

function csvCell(value: string): string {
	return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderCsv(models: Model[], options: Options): string {
	const columns = chosenColumns(options);
	const lines = [columns.map((column) => column.id).join(",")];
	for (const model of models) {
		lines.push(columns.map((column) => csvCell(column.value(model))).join(","));
	}
	return lines.join("\n");
}

export function renderMarkdown(models: Model[], options: Options): string {
	const columns = chosenColumns(options);
	const lines = [
		`| ${columns.map((column) => column.header).join(" | ")} |`,
		`| ${columns.map(() => "---").join(" | ")} |`,
	];
	for (const model of models) {
		lines.push(`| ${columns.map((column) => column.value(model)).join(" | ")} |`);
	}
	return lines.join("\n");
}

/** One footer line for table output; machine formats stay clean. */
export function footer(catalogue: Catalogue, count: number, options: Options): string {
	const parts = [
		`${count} of ${catalogue.models.length} models`,
		`from ${catalogue.sources.join(" + ") || "no source"}`,
	];
	if (catalogue.indexVersion !== null) parts.push(`index ${catalogue.indexVersion}`);
	if (catalogue.stale) parts.push("stale");
	if (options.sort !== undefined)
		parts.push(`sorted by ${options.sort}${options.asc ? " asc" : ""}`);
	const head = parts.join(" · ");
	if (catalogue.notes.length === 0) return head;
	return [head, ...catalogue.notes.map((note) => `note: ${note}`)].join("\n");
}

/** Dispatch the selected row format; JSON is handled by the caller. */
export function renderRows(catalogue: Catalogue, models: Model[], options: Options): string {
	if (options.format === "csv") return renderCsv(models, options);
	if (options.format === "md") return renderMarkdown(models, options);
	const color = colorEnabled(
		options.color,
		process.stdout.isTTY === true,
		Boolean(process.env.NO_COLOR),
	);
	const table = renderTable(models, {
		columns: options.columns.length > 0 ? options.columns : undefined,
		width: options.width ?? process.stdout.columns ?? 120,
		rows: options.rows,
		color,
	});
	return `${table.text}\n\n${footer(catalogue, models.length, options)}`;
}

/** `aa model` in table mode: every field as a labelled line. */
export function renderRecord(model: Model): string {
	const lines: string[] = [];
	const push = (label: string, value: unknown): void => {
		if (value === null || value === undefined || value === "") return;
		lines.push(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
	};
	push("name", model.name);
	push("slug", model.slug);
	push("short name", model.shortName);
	push("creator", model.creator);
	push("keys", model.keys.join(", "));
	push("release", model.release.name);
	push("released", model.release.date);
	push("intelligence", model.intelligenceIndex);
	push("output speed", model.outputSpeed);
	push("latency", model.latency);
	push("context", model.contextWindow);
	push("max output", model.maxOutputTokens);
	push("price in", model.price?.input);
	push("price out", model.price?.output);
	push("price blended", model.price?.blended);
	push("open weights", model.openWeights);
	push("modalities in", model.modalities.input.join(", "));
	push("modalities out", model.modalities.output.join(", "));
	push("reasoning", model.reasoning.supported);
	push("efforts", model.reasoning.efforts.join(", "));
	push("sources", model.sources.join(", "));
	for (const [path, value] of Object.entries(model.evals)) lines.push(`eval ${path}: ${value}`);
	for (const variant of model.variants) {
		const figures = [variant.intelligenceIndex, variant.outputSpeed].filter((v) => v !== null);
		lines.push(`variant ${variant.label ?? variant.slug}: ${figures.join(" / ")}`);
	}
	return lines.join("\n");
}
