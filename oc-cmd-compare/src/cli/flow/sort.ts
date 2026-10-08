import type { Metric, Options } from "~/cli/options.ts";
import type { CompareRow } from "~/types.ts";

export function matches(row: CompareRow, pattern: Options["model"]): boolean {
	if (!pattern) return true;
	try {
		const re = new RegExp(pattern, "i");
		return re.test(row.name) || re.test(row.key);
	} catch {
		return row.name.toLowerCase().includes(pattern.toLowerCase());
	}
}

const maxValue = (r: CompareRow): number | null => {
	const values = [r.oc?.valueIndex, r.cc?.valueIndex].filter(
		(value): value is number => typeof value === "number",
	);
	return values.length === 0 ? null : Math.max(...values);
};
const maxIndex = (r: CompareRow): number =>
	Math.max(r.oc?.index ?? -1, r.cc?.index ?? -1);
const maxRequests = (r: CompareRow): number =>
	Math.max(r.oc?.requestsPerMonth ?? -1, r.cc?.requestsPerMonth ?? -1);
const minPay = (r: CompareRow): number => {
	const values = [r.oc?.payPerRequest, r.cc?.payPerRequest].filter(
		(value): value is number => value !== undefined,
	);
	return values.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...values);
};

/** `asc` means "lower is better"; it flips each metric's default direction. */
export function sortRows(
	rows: CompareRow[],
	metric: Metric,
	asc: boolean,
): CompareRow[] {
	switch (metric) {
		case "name": {
			const sorted = [...rows].sort((a, b) =>
				a.name.localeCompare(b.name),
			);
			return asc ? sorted : sorted.reverse();
		}
		case "val": {
			const scored = rows
				.filter((r) => maxValue(r) !== null)
				.sort(
					(a, b) =>
						((maxValue(a) ?? 0) - (maxValue(b) ?? 0)) *
						(asc ? 1 : -1),
				);
			const unscored = rows.filter((r) => maxValue(r) === null);
			return [...scored, ...unscored];
		}
		case "cost":
			return [...rows].sort(
				(a, b) => (maxIndex(a) - maxIndex(b)) * (asc ? -1 : 1),
			);
		case "perreq":
			return [...rows].sort(
				(a, b) => (minPay(a) - minPay(b)) * (asc ? -1 : 1),
			);
		case "req":
			return [...rows].sort(
				(a, b) => (maxRequests(a) - maxRequests(b)) * (asc ? 1 : -1),
			);
	}
}
