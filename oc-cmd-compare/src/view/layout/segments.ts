import { GAP } from "#~/constants/view.ts";
import type { Column, GroupKey, Segment } from "#~/view/schema.ts";
import { paint } from "#~/view/text/index.ts";

function groupOf(id: string): GroupKey {
	if (id === "model") return "model";
	if (id.startsWith("oc-")) return "oc";
	if (id.startsWith("cc-")) return "cc";
	if (id.startsWith("od-")) return "od";
	return "misc";
}

export function buildSegments(ids: string[], cols: Column[], widths: number[]): Segment[] {
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
		seg.width = seg.widths.reduce((a, b) => a + b, 0) + GAP.length * (seg.widths.length - 1);
	}
	return segs;
}

function cellText(col: Column, text: string, width: number, alignRight: boolean): string {
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
			const text = cellText(col, cells[i] ?? "", seg.widths[i] ?? 0, alignRight);
			const code = styles?.[i];
			return code ? paint(code, text) : text;
		})
		.join(GAP);
}

import type { EntryMetrics } from "#~/types.ts";
import type { Row, Tally } from "#~/view/schema.ts";

export function tally(rows: Row[]): Tally {
	const result: Tally = {
		headToHead: 0,
		ocWins: 0,
		ccWins: 0,
		odWins: 0,
		ties: 0,
		ocOnly: 0,
		ccOnly: 0,
		odOnly: 0,
	};
	for (const row of rows) {
		const present = [row.oc, row.cc, row.od].filter(
			(entry): entry is EntryMetrics => entry !== undefined,
		);
		if (present.length === 0) continue;
		if (present.length === 1) {
			if (row.oc) result.ocOnly++;
			else if (row.cc) result.ccOnly++;
			else result.odOnly++;
			continue;
		}
		result.headToHead++;
		const cheapest = Math.min(...present.map((entry) => entry.payPerRequest));
		const wins = present.filter((entry) => entry.payPerRequest === cheapest);
		const winner = wins[0];
		if (wins.length !== 1 || !winner) result.ties++;
		else if (winner === row.oc) result.ocWins++;
		else if (winner === row.cc) result.ccWins++;
		else result.odWins++;
	}
	return result;
}
