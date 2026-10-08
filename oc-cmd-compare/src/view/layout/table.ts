import { BAR, BAR_RULE, SGR } from "~/constants/view.ts";
import type { Column, GroupKey, GroupLabel, Row } from "~/view/schema.ts";
import { columns } from "~/view/schema.ts";
import { paint } from "~/view/text/index.ts";
import { buildSegments, renderSegment } from "./segments.ts";

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

export function printTable(
	rows: Row[],
	columnIds: string[],
	labels: Partial<Record<GroupKey, GroupLabel>>,
): void {
	const { cols, widths } = measure(rows, columnIds);
	const segs = buildSegments(columnIds, cols, widths);
	const bar = paint(SGR.dim, BAR);

	if (segs.some((seg) => labels[seg.key])) {
		console.log(
			segs
				.map((seg) => {
					const label = labels[seg.key];
					if (!label) return " ".repeat(seg.width);
					const left = Math.max(
						0,
						Math.floor((seg.width - label.title.length) / 2),
					);
					return paint(
						label.color,
						label.title
							.padStart(left + label.title.length)
							.padEnd(seg.width),
					);
				})
				.join(bar),
		);
	}

	console.log(
		segs
			.map((seg) =>
				// Each provider block's headers take that provider's colour, so a
				// column's side reads from the header, not only the banner above.
				paint(
					labels[seg.key]?.color ?? SGR.bold,
					renderSegment(
						seg,
						seg.columns.map((c) => c.header),
						false,
					),
				),
			)
			.join(bar),
	);
	console.log(
		segs.map((seg) => "─".repeat(seg.width)).join(paint(SGR.dim, BAR_RULE)),
	);
	for (const row of rows) {
		console.log(
			segs
				.map((seg) =>
					renderSegment(
						seg,
						seg.columns.map((c) => c.value(row)),
						true,
						seg.columns.map((c) => c.style?.(row)),
					),
				)
				.join(bar),
		);
	}
}
