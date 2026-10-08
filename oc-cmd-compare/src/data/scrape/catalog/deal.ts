import { BADGE, BOUNDARY, ENDS } from "~/constants/data.ts";
import { cellText } from "~/data/scrape/tables.ts";
import type { Deal } from "~/types.ts";

/**
 * Read the promotion from a raw model name cell. `nameCell` deliberately keeps
 * only the first text node — the one that is the name — so the badges that
 * follow it are dropped at the door unless they are read here.
 *
 * Cells look like `Grok 4.7` BOUNDARY `-40%` BOUNDARY `Ends September 27, 2026`
 * or `Pixel Canary` BOUNDARY `Free`.
 */
export function dealIn(cell: string): Deal | undefined {
	const parts = cell.split(BOUNDARY).map(cellText).filter(Boolean);
	const rest = parts.slice(1);
	const badge = rest.find((part) => BADGE.test(part));
	if (!badge) return undefined;
	const ends = rest.find((part) => ENDS.test(part));
	return ends ? { badge, ends } : { badge };
}
