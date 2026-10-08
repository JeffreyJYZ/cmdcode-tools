import {
	cellText,
	headerIndex,
	nameCell,
	type Table,
} from "~/data/scrape/tables.ts";
import { normalizeKey } from "~/keys.ts";

/**
 * Pull one numeric column out of any tables that carry it, keyed by model.
 * Used for benchmark columns like CommandCode's "Intelligence".
 */
export function extractNumericColumn(
	tables: Table[],
	header: RegExp,
): Map<string, number> {
	const scores = new Map<string, number>();
	for (const table of tables) {
		const headerCells = (table[0] ?? []).map(cellText);
		const col = headerIndex(headerCells, header);
		if (col < 0) continue;
		for (const cells of table.slice(1)) {
			const key = normalizeKey(nameCell(cells[0] ?? ""));
			if (!key || scores.has(key)) continue;
			const match = (cells[col] ?? "").match(/-?[0-9]+(?:\.[0-9]+)?/);
			if (match) scores.set(key, Number(match[0]));
		}
	}
	return scores;
}
