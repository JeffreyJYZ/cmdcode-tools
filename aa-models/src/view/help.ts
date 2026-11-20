import { pad } from "#~/view/format.ts";
import { COLUMNS, DEFAULT_COLUMNS } from "#~/view/columns.ts";

/** Column legend: [column, one-line meaning], in table order. */
export const LEGEND: [string, string][] = [
	["NAME", "model name as AA prints it"],
	["INTEL", "Artificial Analysis Intelligence Index (null when unmeasured, never 0)"],
	["T/PS", "median output tokens per second"],
	["CTX", "context window in tokens"],
	["IN / OUT", "USD per 1M tokens, when AA publishes a price"],
	["RELEASED", "release date from AA (YYYY-MM-DD)"],
	["OPEN", "open weights: open, closed, or — when AA does not say"],
	["—", "a value AA does not publish; never rendered as 0"],
];

/** The legend block, one line per entry. */
export function legendText(): string {
	return LEGEND.map(([column, meaning]) => `${pad(column, 12, "left")} ${meaning}`).join("\n");
}

/** `--columns help`, generated from the registry so it cannot drift. */
export function columnHelp(): string {
	const lines = COLUMNS.map(
		(column) =>
			`  ${pad(column.id, 10, "left")} ${column.desc}${column.drop === undefined ? "" : ` (drop ${column.drop})`}`,
	);
	return [
		"Available columns (--columns a,b,c):",
		...lines,
		"",
		`Default: ${DEFAULT_COLUMNS.join(", ")}`,
		"An explicit --columns list is never trimmed to the terminal width;",
		"a default table drops the lowest-priority columns instead (lower drop first).",
	].join("\n");
}
