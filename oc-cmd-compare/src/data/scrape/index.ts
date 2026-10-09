export { extractCatalog } from "./catalog/catalog.ts";
export { dealIn } from "./catalog/deal.ts";
export { extractNumericColumn } from "./catalog/numeric.ts";
export { parseRoleRows } from "./roleRows.ts";
export type { Table } from "./tables.ts";
export {
	cellText,
	headerIndex,
	nameCell,
	parseMoney,
	parseTables,
} from "./tables.ts";
export { parseTabTables, type TabTable } from "./tabs.ts";

export async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, {
		headers: { "user-agent": "mpc/0.1 (+model price compare)" },
	});
	if (!res.ok)
		throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
	return res.text();
}
