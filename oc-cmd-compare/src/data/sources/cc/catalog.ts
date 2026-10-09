import { CC_PLANS } from "#~/constants/sources.ts";
import {
	extractCatalog,
	fetchText,
	parseRoleRows,
	parseTables,
} from "#~/data/scrape/index.ts";
import type { CatalogEntry } from "#~/types.ts";

/** Per-model token rates + monthly credit allowance for a CommandCode plan. */
export async function loadCcCatalog(planId: string): Promise<CatalogEntry[]> {
	const def = CC_PLANS[planId];
	if (!def) throw new Error(`unknown CommandCode plan "${planId}"`);
	const url = `https://commandcode.ai/docs/plans/${def.slug}`;
	const html = await fetchText(url);

	// The page shape is chosen by the plan, not inferred from the absence of a
	// credit column. Go's list moved from a `role="row"` div grid to a real
	// <table> while still publishing no per-model credits, so "no credit header"
	// no longer means "grid" — inferring it sent Go down `parseRoleRows`, which
	// matches no row, and the load threw.
	const tables = def.grid
		? await parseRoleRows(html)
		: await parseTables(html);
	const entries = extractCatalog(tables, {
		provider: "cc",
		plan: def.label,
		creditHeader: def.creditHeader,
		// A rate-only list (Go) bills every model against the plan's whole pool.
		defaultAllowance: def.standardAllowance,
	});
	if (entries.length === 0) {
		const shape = def.grid ? "row" : "table";
		throw new Error(
			`no model ${shape}s parsed from ${url} — docs layout may have changed`,
		);
	}
	if (def.creditHeader && def.standardAllowance !== undefined) {
		fillDeals(
			entries,
			extractCatalog(tables, {
				provider: "cc",
				plan: def.label,
				defaultAllowance: def.standardAllowance,
			}),
		);
	}
	return entries;
}

/**
 * Fold the rate-only pass into the priced one: it adds models the credits
 * tables omit entirely (the free ones), and lends its promotion badges to
 * entries that came from a credits table — those carry no badges, so without
 * this a paid model silently loses the deal published beside its name.
 */
export function fillDeals(
	entries: CatalogEntry[],
	rateOnly: CatalogEntry[],
): void {
	const byKey = new Map(entries.map((entry) => [entry.key, entry]));
	for (const entry of rateOnly) {
		const existing = byKey.get(entry.key);
		if (!existing) {
			byKey.set(entry.key, entry);
			entries.push(entry);
			continue;
		}
		if (!existing.deal && entry.deal) existing.deal = entry.deal;
	}
}
