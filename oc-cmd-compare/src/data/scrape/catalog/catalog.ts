import {
	cellText,
	headerIndex,
	nameCell,
	parseMoney,
	type Table,
} from "~/data/scrape/tables.ts";
import { displayName, normalizeKey } from "~/keys.ts";
import type { CatalogEntry, ModelPricing, ProviderId } from "~/types.ts";
import { dealIn } from "./deal.ts";
import { variantScore } from "./variant.ts";

interface CatalogOptions {
	provider: ProviderId;
	plan: string;
	/** Matches the header cell that carries the per-model allowance. */
	creditHeader?: RegExp;
	/** Allowance to assume for rate-only tables (no allowance column). */
	defaultAllowance?: number;
	/** OpenCode Go only: prefer peak-rate rows over off-peak. */
	peak?: boolean;
}

function pricingOf(
	cells: string[],
	cols: { in: number; out: number; cache: number; write: number },
): ModelPricing {
	return {
		input: parseMoney(cells[cols.in] ?? "") ?? 0,
		output: parseMoney(cells[cols.out] ?? "") ?? 0,
		cacheRead:
			cols.cache >= 0 ? (parseMoney(cells[cols.cache] ?? "") ?? 0) : 0,
		cacheWrite:
			cols.write >= 0 ? parseMoney(cells[cols.write] ?? "") : null,
	};
}

/**
 * Extract a provider catalog from already-parsed tables. Only tables whose
 * header carries Input + Output + an allowance column qualify, so the wide
 * "models included" tables are ignored.
 */
export function extractCatalog(
	tables: Table[],
	options: CatalogOptions,
): CatalogEntry[] {
	const {
		provider,
		plan,
		creditHeader,
		defaultAllowance,
		peak = false,
	} = options;
	const best = new Map<string, { entry: CatalogEntry; score: number }>();

	for (const table of tables) {
		const header = (table[0] ?? []).map(cellText);
		if (header.length < 4) continue;
		const cols = {
			in: headerIndex(header, /^input/i),
			out: headerIndex(header, /^output/i),
			cache: headerIndex(header, /cache(d)?\s*read/i),
			write: headerIndex(header, /cache\s*write/i),
		};
		const creditCol = creditHeader ? headerIndex(header, creditHeader) : -2;
		if (cols.in < 0 || cols.out < 0) continue;
		if (creditHeader && creditCol < 0) continue;
		if (!creditHeader && defaultAllowance === undefined) continue;

		for (const cells of table.slice(1)) {
			const rawName = nameCell(cells[0] ?? "");
			const deal = dealIn(cells[0] ?? "");
			if (!rawName) continue;
			const allowance = creditHeader
				? parseMoney(cells[creditCol] ?? "")
				: (defaultAllowance ?? 0);
			if (allowance === null) continue;
			const key = normalizeKey(rawName);
			if (!key) continue;

			const score = variantScore(rawName, peak);
			const existing = best.get(key);
			if (existing && existing.score <= score) continue;
			best.set(key, {
				score,
				entry: {
					provider,
					plan,
					key,
					name: displayName(rawName),
					pricing: pricingOf(cells, cols),
					allowance,
					...(deal ? { deal } : {}),
				},
			});
		}
	}
	return [...best.values()].map((v) => v.entry);
}
