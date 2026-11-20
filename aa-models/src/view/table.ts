import type { Model } from "#~/model.ts";
import { DEFAULT_COLUMNS, type Column, pickColumns } from "#~/view/columns.ts";
import { EMPTY, SGR, clip, pad, paint } from "#~/view/format.ts";

export interface TableOptions {
	/** Exact column set; when given, no column is dropped for width. */
	columns?: string[];
	/** Character budget for the table; absent or 0 disables trimming. */
	width?: number;
	/** Row cap; 0 or absent keeps every row. */
	rows?: number;
	color: boolean;
}

export interface TableRender {
	text: string;
	/** Columns removed to fit `width`, in removal order. */
	dropped: string[];
	/** Rows hidden by the `rows` cap. */
	hidden: number;
}

function cellWidths(models: Model[], columns: Column[]): number[] {
	return columns.map((column) => {
		let width = Math.min(column.header.length, column.gain);
		for (const model of models) {
			const length = clip(column.value(model), column.gain).length;
			if (length > width) width = length;
		}
		return width;
	});
}

function totalWidth(widths: number[]): number {
	const gaps = Math.max(widths.length - 1, 0) * 2;
	return widths.reduce((sum, width) => sum + width, 0) + gaps;
}

/** Drop the lowest-priority column until the table fits; declaration order breaks a tie. */
function fitToWidth(
	models: Model[],
	columns: Column[],
	limit: number,
): { columns: Column[]; dropped: string[] } {
	let current = [...columns];
	const dropped: string[] = [];
	while (limit > 0 && current.length > 1 && totalWidth(cellWidths(models, current)) > limit) {
		const droppable = current.filter((column) => column.drop !== undefined);
		if (droppable.length === 0) break;
		const lowest = Math.min(...droppable.map((column) => column.drop ?? 0));
		const victim = droppable.find((column) => column.drop === lowest);
		if (!victim) break;
		current = current.filter((column) => column.id !== victim.id);
		dropped.push(victim.id);
	}
	return { columns: current, dropped };
}

function cellText(
	model: Model,
	column: Column,
	width: number,
	color: boolean,
	last: boolean,
): string {
	const raw = column.value(model);
	const padded = last ? raw : pad(clip(raw, column.gain), width, column.align);
	if (raw === EMPTY) return paint(padded, SGR.dim, color);
	return paint(padded, SGR.green, color && column.good?.(model) === true);
}

/**
 * Render rows as an aligned table. Trims to `width` by dropping the lowest-priority
 * columns (never one the user named), and reports what went and how many rows the cap
 * hid. The final column is not right-padded, so no line ends in spaces.
 */
export function renderTable(models: Model[], options: TableOptions): TableRender {
	const cap = options.rows !== undefined && options.rows > 0 ? options.rows : 0;
	const shown = cap > 0 ? models.slice(0, cap) : models;
	const hidden = models.length - shown.length;
	const picked = pickColumns(options.columns ?? DEFAULT_COLUMNS);
	const fitted =
		options.columns !== undefined
			? { columns: picked, dropped: [] }
			: fitToWidth(shown, picked, options.width ?? 0);
	const widths = cellWidths(shown, fitted.columns);
	const last = fitted.columns.length - 1;
	const lines = [
		fitted.columns
			.map((column, i) =>
				paint(
					i === last
						? column.header
						: pad(column.header, widths[i] ?? column.gain, column.align),
					SGR.bold,
					options.color,
				),
			)
			.join("  "),
	];
	for (const model of shown) {
		lines.push(
			fitted.columns
				.map((column, i) =>
					cellText(model, column, widths[i] ?? column.gain, options.color, i === last),
				)
				.join("  "),
		);
	}
	if (hidden > 0) lines.push(paint(`… ${hidden} more`, SGR.dim, options.color));
	if (fitted.dropped.length > 0) {
		lines.push(
			paint(`dropped for width: ${fitted.dropped.join(", ")}`, SGR.dim, options.color),
		);
	}
	return { text: lines.join("\n"), dropped: fitted.dropped, hidden };
}
