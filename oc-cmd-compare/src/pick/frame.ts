import { DETAIL_COLUMNS, GAP, OD_BY_TIER, withOd } from "#~/constants/view.ts";
import type { CompareRow } from "#~/types.ts";
import { fitColumns, renderText } from "#~/view/render.ts";
import type { ReportMeta } from "#~/view/schema.ts";
import { columns } from "#~/view/schema.ts";
import { clip } from "#~/view/text/format.ts";
import { PICK_KEYS } from "#~/view/text/help.ts";
import { fitLine } from "./text.ts";

const MARK = "▸ ";
const BLANK = "  ";
const RULE = "─";

/** Fixed widths so the tail columns never jitter while the query narrows. */
const TAIL = [
	{ id: "oc-reqmo", width: 6, right: true },
	{ id: "cc-reqmo", width: 6, right: true },
	{ id: "win", width: 7, right: false },
	{ id: "val", width: 4, right: true },
];
const TAIL_COLUMNS = columns(TAIL.map((spec) => spec.id));
const TAIL_WIDTH = TAIL.reduce((sum, spec) => sum + spec.width, 0) + GAP.length * (TAIL.length - 1);

export interface FrameInput {
	query: string;
	/** Rows the query hits, already ranked. */
	rows: CompareRow[];
	/** Rows before filtering, for the header count. */
	total: number;
	selected: number;
	width: number;
	height: number;
	/** The highlighted row's table, from `detailLines`. */
	detail: string[];
}

/** The table's own cells, so an absent side reads `—` exactly like the table. */
function tailCells(row: CompareRow): string {
	return TAIL_COLUMNS.map((col, i) => {
		const spec = TAIL[i];
		if (!spec) return "";
		const text = clip(col.value(row), spec.width);
		return spec.right ? text.padStart(spec.width) : text.padEnd(spec.width);
	}).join(GAP);
}

function listLine(row: CompareRow, selected: boolean, width: number): string {
	const nameWidth = Math.max(8, width - MARK.length - GAP.length - TAIL_WIDTH);
	const name = clip(row.name, nameWidth).padEnd(nameWidth);
	return `${selected ? MARK : BLANK}${name}${GAP}${tailCells(row)}`;
}

/** Scroll the visible slice so the highlight stays inside it. */
function windowStart(selected: number, count: number, height: number): number {
	return Math.max(0, Math.min(selected - Math.floor(height / 2), count - height));
}

/** Build one full frame as plain lines; the caller writes and clears the rest. */
export function frameLines(frame: FrameInput): string[] {
	const width = Math.max(20, frame.width);
	const height = Math.max(6, frame.height);
	const rule = RULE.repeat(width);
	const lines: string[] = [
		clip(`mpc pick · ${frame.rows.length} of ${frame.total} models`, width),
		clip(`query: ${frame.query}█`, width),
		rule,
	];

	const chrome = 4 + (frame.detail.length > 0 ? 1 : 0);
	let detailCount =
		frame.detail.length > 0
			? Math.min(frame.detail.length, Math.max(1, Math.floor(height / 2)))
			: 0;
	let listHeight = height - chrome - detailCount;
	if (listHeight < 1) {
		detailCount = Math.max(0, detailCount + listHeight - 1);
		listHeight = 1;
	}

	if (frame.rows.length === 0) {
		lines.push(clip(`  no model matches "${frame.query}"`, width));
	} else {
		const start = windowStart(frame.selected, frame.rows.length, listHeight);
		for (const [i, row] of frame.rows.slice(start, start + listHeight).entries()) {
			const at = start + i;
			lines.push(fitLine(listLine(row, at === frame.selected, width), width));
		}
	}

	if (detailCount > 0) {
		lines.push(rule);
		for (const line of frame.detail.slice(0, detailCount)) lines.push(fitLine(line, width));
	}
	lines.push(clip(PICK_KEYS, width));
	return lines;
}

/**
 * The highlighted model's table: the normal renderer on a one-row slice with
 * every `--detail` column, trimmed to the terminal. The footer is dropped by
 * cutting at the blank line `renderText` puts between table and footer.
 */
export function detailLines(row: CompareRow, meta: ReportMeta, width: number): string[] {
	const ids = meta.odPlan ? withOd(DETAIL_COLUMNS, OD_BY_TIER.detail) : DETAIL_COLUMNS;
	const fitted = fitColumns([row], ids, Math.max(20, width));
	const lines: string[] = [];
	const saved = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	try {
		renderText([row], meta, fitted.ids);
	} finally {
		console.log = saved;
	}
	const cut = lines.indexOf("");
	return cut === -1 ? lines : lines.slice(0, cut);
}
