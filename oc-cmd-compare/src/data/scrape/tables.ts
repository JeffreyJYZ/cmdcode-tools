import { BOUNDARY } from "#~/constants/data.ts";

export type Table = string[][];

function clean(text: string): string {
	return text
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Collapse a raw cell (boundary markers included) into plain text. */
export function cellText(cell: string): string {
	return clean(cell.split(BOUNDARY).join(" "));
}

/** The first text node of a cell; deal badges live in later nodes. */
export function nameCell(cell: string): string {
	return cellText(cell.split(BOUNDARY)[0] ?? "");
}

/** Parse every <table> on a page into rows of trimmed cell text. */
export async function parseTables(html: string): Promise<Table[]> {
	const tables: Table[] = [];
	let table: Table | null = null;
	let row: string[] | null = null;
	let cell: string | null = null;

	const rewriter = new HTMLRewriter()
		.on("table", {
			element(el) {
				table = [];
				el.onEndTag(() => {
					if (table) tables.push(table);
					table = null;
				});
			},
		})
		.on("tr", {
			element(el) {
				const start = table;
				row = [];
				el.onEndTag(() => {
					if (row && start) start.push(row);
					row = null;
				});
			},
		})
		.on("th, td", {
			element(el) {
				const current = row;
				cell = "";
				el.onEndTag(() => {
					// BOUNDARY marks a text-node boundary so "$60" + "4x" stays
					// two tokens instead of collapsing into "$604x".
					if (current) current.push((cell ?? "").trim());
					cell = null;
				});
			},
			text(chunk) {
				if (cell !== null) cell += `${chunk.text}${BOUNDARY}`;
			},
		});

	await rewriter.transform(new Response(html)).text();
	return tables;
}

/**
 * Pull USD out of a price/allowance cell. Cells carry BOUNDARY text-node
 * boundaries; each segment is scanned and the last one carrying a price wins,
 * which skips trailing multiplier notes like "4x". "Free" is 0, em-dash null.
 */
export function parseMoney(cell: string): number | null {
	let result: number | null = null;
	for (const segment of cell.split(BOUNDARY)) {
		const s = segment.replace(/~~/g, "").trim();
		if (/\bfree\b/i.test(s)) return 0;
		const matches = [...s.matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/g)];
		if (matches.length > 0) {
			result = Number(matches[matches.length - 1]?.[1]);
		}
	}
	return result;
}

/** Match a table header cell, ignoring sort arrows and punctuation. */
export function headerIndex(header: string[], pattern: RegExp): number {
	return header.findIndex((h) => {
		const norm = h
			.replace(/[^a-z0-9 ]+/gi, " ")
			.replace(/\s+/g, " ")
			.trim();
		return pattern.test(norm);
	});
}
