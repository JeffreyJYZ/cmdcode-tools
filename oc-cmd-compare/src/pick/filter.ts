import { nameTier } from "#~/cli/flow/sort.ts";
import type { CompareRow } from "#~/types.ts";
import type { PickKey } from "./keys.ts";

/** Everything the picker knows between two redraws. */
export interface PickState {
	query: string;
	selected: number;
	done: "quit" | "choose" | null;
}

export const initialPickState = (): PickState => ({ query: "", selected: 0, done: null });

/**
 * Rows the query hits, best first: a name that starts with it, then one that
 * starts a word, then one that only contains it. Ties keep the caller's order,
 * which is the `--metric` sort, so an empty query is the table itself.
 */
export function filterRows(rows: CompareRow[], query: string): CompareRow[] {
	if (query === "") return rows;
	const ranked: { row: CompareRow; tier: number; at: number }[] = [];
	rows.forEach((row, at) => {
		const tier = nameTier(row, query);
		if (tier !== null) ranked.push({ row, tier, at });
	});
	ranked.sort((a, b) => a.tier - b.tier || a.at - b.at);
	return ranked.map((item) => item.row);
}

/** The selected row, or undefined when nothing matched. */
export function selectedRow(state: PickState, rows: CompareRow[]): CompareRow | undefined {
	return rows[state.selected];
}

/**
 * Apply one key. `count` is the row count *before* this key, which is only what
 * movement needs; a query change resets the selection and the caller re-clamps.
 */
export function applyKey(state: PickState, key: PickKey, count: number): PickState {
	switch (key.type) {
		case "text":
			// With an empty query j/k browse and q quits, so a search for "kimi" or
			// "qwen" is still reachable through any fragment ("imi", "wen"); once a
			// single character is typed every key is part of the query.
			if (state.query === "") {
				if (key.text === "q") return { ...state, done: "quit" };
				if (key.text === "j") return applyKey(state, { type: "down" }, count);
				if (key.text === "k") return applyKey(state, { type: "up" }, count);
			}
			return { query: state.query + key.text, selected: 0, done: null };
		case "backspace":
			return { query: state.query.slice(0, -1), selected: 0, done: null };
		case "up":
			return { ...state, selected: Math.max(0, state.selected - 1) };
		case "down":
			return { ...state, selected: Math.min(Math.max(0, count - 1), state.selected + 1) };
		case "enter":
			return count === 0 ? state : { ...state, done: "choose" };
		case "cancel":
		case "eof":
			return { ...state, done: "quit" };
		default:
			return state;
	}
}
