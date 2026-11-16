import type { Metric, Options } from "#~/cli/options.ts";
import type { CompareRow, EntryMetrics } from "#~/types.ts";

export function matches(row: CompareRow, pattern: Options["model"]): boolean {
	if (!pattern) return true;
	try {
		const re = new RegExp(pattern, "i");
		return re.test(row.name) || re.test(row.key);
	} catch {
		return row.name.toLowerCase().includes(pattern.toLowerCase());
	}
}

/** Every side this invocation is comparing, present or not. */
export function expectedSides(options: Options): ("oc" | "cc" | "od")[] {
	return options.odPlan ? ["oc", "cc", "od"] : ["oc", "cc"];
}

function present(row: CompareRow): EntryMetrics[] {
	return [row.oc, row.cc, row.od].filter((entry): entry is EntryMetrics => entry !== undefined);
}

const maxValue = (r: CompareRow): number | null => {
	const values = present(r)
		.map((entry) => entry.valueIndex)
		.filter((value): value is number => typeof value === "number");
	return values.length === 0 ? null : Math.max(...values);
};
const maxIndex = (r: CompareRow): number => Math.max(...present(r).map((e) => e.index), -1);
const maxRequests = (r: CompareRow): number =>
	Math.max(...present(r).map((e) => e.requestsPerMonth), -1);
const minPay = (r: CompareRow): number =>
	Math.min(...present(r).map((e) => e.payPerRequest), Number.POSITIVE_INFINITY);

/** Filter first (`--model`, `--only`), then order. */
export function selectRows(rows: CompareRow[], options: Options): CompareRow[] {
	const sides = expectedSides(options);
	return rows.filter((row) => {
		if (!matches(row, options.model)) return false;
		return options.only === "all" || sides.every((side) => Boolean(row[side]));
	});
}

/** `asc` means "lower is better"; it flips each metric's default direction. */
export function sortRows(rows: CompareRow[], metric: Metric, asc: boolean): CompareRow[] {
	switch (metric) {
		case "name": {
			const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
			return asc ? sorted : sorted.reverse();
		}
		case "val": {
			const scored = rows
				.filter((r) => maxValue(r) !== null)
				.sort((a, b) => ((maxValue(a) ?? 0) - (maxValue(b) ?? 0)) * (asc ? 1 : -1));
			const unscored = rows.filter((r) => maxValue(r) === null);
			return [...scored, ...unscored];
		}
		case "cost":
			return [...rows].sort((a, b) => (maxIndex(a) - maxIndex(b)) * (asc ? -1 : 1));
		case "perreq":
			return [...rows].sort((a, b) => (minPay(a) - minPay(b)) * (asc ? -1 : 1));
		case "req":
			return [...rows].sort((a, b) => (maxRequests(a) - maxRequests(b)) * (asc ? 1 : -1));
	}
}
