import { BAR } from "~/constants/view.ts";
import type { Column, FitResult, Row } from "~/view/schema.ts";
import { columns } from "~/view/schema.ts";
import { buildSegments } from "./segments.ts";

function measure(
	rows: Row[],
	ids: string[],
): { cols: Column[]; widths: number[] } {
	const cols = columns(ids);
	const widths = cols.map((c) => c.header.length);
	for (const row of rows) {
		cols.forEach((c, i) => {
			const len = c.value(row).length;
			if (len > (widths[i] ?? 0)) widths[i] = len;
		});
	}
	return { cols, widths };
}

/** Printed width of the whole table, in characters (ANSI colour not counted). */
export function tableWidth(rows: Row[], ids: string[]): number {
	const { cols, widths } = measure(rows, ids);
	const segs = buildSegments(ids, cols, widths);
	if (segs.length === 0) return 0;
	return (
		segs.reduce((sum, seg) => sum + seg.width, 0) +
		BAR.length * (segs.length - 1)
	);
}

/**
 * Drop optional columns, widest-first, until the table fits `limit`. Columns
 * with the same `drop` value are removed together, so both providers stay
 * symmetric.
 */
export function fitColumns(
	rows: Row[],
	ids: string[],
	limit: number,
): FitResult {
	let current = [...ids];
	const dropped: string[] = [];
	while (limit > 0 && tableWidth(rows, current) > limit) {
		const levels = current
			.map((id) => columns([id])[0]?.drop)
			.filter((drop): drop is number => drop !== undefined);
		if (levels.length === 0) break;
		const lowest = Math.min(...levels);
		const remove = new Set(
			current.filter((id) => columns([id])[0]?.drop === lowest),
		);
		if (remove.size === 0) break;
		current = current.filter((id) => !remove.has(id));
		dropped.push(...remove);
	}
	return { ids: current, dropped, width: tableWidth(rows, current) };
}
