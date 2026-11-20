import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures");

/** The `initialModels` rows saved from a live AA page. */
export function readRows(name: string): unknown[] {
	const parsed = JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as {
		initialModels: unknown[];
	};
	return parsed.initialModels;
}

/**
 * Rebuild the page exactly as AA serves it: one RSC chunk whose argument is a JSON
 * string, so `decodeFlight` decodes real escaped quotes rather than raw HTML.
 */
export function aaPage(rows: unknown[]): string {
	const flight = JSON.stringify({ initialModels: rows });
	return `<html><body><script>self.__next_f.push([1,${JSON.stringify(flight)}])</script></body></html>`;
}
