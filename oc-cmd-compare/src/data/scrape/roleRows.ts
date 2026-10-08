import { BOUNDARY } from "~/constants/data.ts";
import type { Table } from "./tables.ts";

/**
 * Parse `role="row"` div grids (CommandCode's model catalog on some plan
 * pages) into the same Table shape as parseTables.
 */
export async function parseRoleRows(html: string): Promise<Table[]> {
	let grid: Table | null = null;
	let row: string[] | null = null;
	let cell: string | null = null;

	const rewriter = new HTMLRewriter()
		.on('div[role="row"]', {
			element(el) {
				grid ??= [];
				const start = grid;
				row = [];
				el.onEndTag(() => {
					if (row && start) start.push(row);
					row = null;
				});
			},
		})
		.on('div[role="row"] > div', {
			element(el) {
				const current = row;
				cell = "";
				el.onEndTag(() => {
					if (current) current.push((cell ?? "").trim());
					cell = null;
				});
			},
			text(chunk) {
				if (cell !== null) cell += `${chunk.text}${BOUNDARY}`;
			},
		});

	await rewriter.transform(new Response(html)).text();
	return grid ? [grid] : [];
}
