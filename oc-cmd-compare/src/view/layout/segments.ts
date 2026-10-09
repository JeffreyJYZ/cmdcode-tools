import { GAP } from "#~/constants/view.ts";
import type { Column, GroupKey, Segment } from "#~/view/schema.ts";
import { paint } from "#~/view/text/index.ts";

function groupOf(id: string): GroupKey {
	if (id === "model") return "model";
	if (id.startsWith("oc-")) return "oc";
	if (id.startsWith("cc-")) return "cc";
	return "misc";
}

export function buildSegments(
	ids: string[],
	cols: Column[],
	widths: number[],
): Segment[] {
	const segs: Segment[] = [];
	ids.forEach((id, i) => {
		const column = cols[i];
		if (!column) return;
		const key = groupOf(id);
		const last = segs[segs.length - 1];
		if (!last || last.key !== key) {
			segs.push({
				key,
				columns: [column],
				widths: [widths[i] ?? 0],
				width: 0,
			});
		} else {
			last.columns.push(column);
			last.widths.push(widths[i] ?? 0);
		}
	});
	for (const seg of segs) {
		seg.width =
			seg.widths.reduce((a, b) => a + b, 0) +
			GAP.length * (seg.widths.length - 1);
	}
	return segs;
}

function cellText(
	col: Column,
	text: string,
	width: number,
	alignRight: boolean,
): string {
	if (col.pad === false) return text;
	return alignRight && col.right ? text.padStart(width) : text.padEnd(width);
}

export function renderSegment(
	seg: Segment,
	cells: string[],
	alignRight: boolean,
	styles?: (string | undefined)[],
): string {
	return seg.columns
		.map((col, i) => {
			const text = cellText(
				col,
				cells[i] ?? "",
				seg.widths[i] ?? 0,
				alignRight,
			);
			const code = styles?.[i];
			return code ? paint(code, text) : text;
		})
		.join(GAP);
}

import type { Row, Tally } from "#~/view/schema.ts";

export function tally(rows: Row[]): Tally {
	const result: Tally = {
		headToHead: 0,
		ocWins: 0,
		ccWins: 0,
		ties: 0,
		ocOnly: 0,
		ccOnly: 0,
	};
	for (const row of rows) {
		if (row.oc && row.cc) {
			result.headToHead++;
			if (row.oc.payPerRequest === row.cc.payPerRequest) result.ties++;
			else if (row.oc.payPerRequest < row.cc.payPerRequest)
				result.ocWins++;
			else result.ccWins++;
		} else if (row.oc) {
			result.ocOnly++;
		} else if (row.cc) {
			result.ccOnly++;
		}
	}
	return result;
}
