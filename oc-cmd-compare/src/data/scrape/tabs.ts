import { BOUNDARY } from "#~/constants/data.ts";
import type { Table } from "./tables.ts";

/** A table plus the label of the `<tabpanel>` it sits in ("" outside tabs). */
export interface TabTable {
	label: string;
	table: Table;
}

/**
 * Parse every <table> on a page, tagging each with the label of the
 * `role="tabpanel"` it belongs to. Starlight renders each `<TabItem label="…">`
 * as a labelled tabpanel, so this is how two otherwise identical tables are
 * told apart — the Go and Go Plus catalogs share headers and token rates, and
 * differ only in the monthly-limit values.
 *
 * Labels come from the `<a role="tab" href="#tab-panel-N">` anchors, which the
 * document places before the panels: the anchor end-tag fills the map, then the
 * matching panel's table inherits its label.
 */
export async function parseTabTables(html: string): Promise<TabTable[]> {
	const labels = new Map<string, string>();
	const tables: TabTable[] = [];
	let anchorHref: string | null = null;
	let anchorText = "";
	let label: string | null = null;
	let table: Table | null = null;
	let row: string[] | null = null;
	let cell: string | null = null;

	const rewriter = new HTMLRewriter()
		.on('a[role="tab"]', {
			element(el) {
				anchorHref = el.getAttribute("href");
				anchorText = "";
				el.onEndTag(() => {
					const id = (anchorHref ?? "").replace(/^#/, "");
					if (id) labels.set(id, anchorText.trim());
					anchorHref = null;
				});
			},
			text(chunk) {
				anchorText += chunk.text;
			},
		})
		.on('div[role="tabpanel"]', {
			element(el) {
				label = labels.get(el.getAttribute("id") ?? "") ?? null;
				el.onEndTag(() => {
					label = null;
				});
			},
		})
		.on("table", {
			element(el) {
				table = [];
				const start = table;
				el.onEndTag(() => {
					if (start)
						tables.push({ label: label ?? "", table: start });
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
