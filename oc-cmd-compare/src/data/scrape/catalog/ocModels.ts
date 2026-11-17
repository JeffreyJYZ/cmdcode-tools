import { displayName, normalizeKey } from "#~/keys.ts";
import type { CatalogEntry } from "#~/types.ts";

/**
 * The Go model catalog is no longer published as an HTML table: the docs
 * article links to the console, whose server-rendered table has monthly
 * limits but no token prices. `/zen/go/v1/models` is the only source with
 * both. This module maps that JSON onto the same `CatalogEntry` shape the
 * old table scraper produced.
 */

interface GoModel {
	id: string;
	name: string;
	cost?: {
		text?: {
			input?: {
				price?: number;
				cache?: { read?: number; write?: number | Record<string, number> };
			};
			output?: { price?: number };
		};
	};
	go?: { monthly_usage?: Record<string, number | null> | null };
}

/** The two plan fields the parser needs; supplied by `OC_PLANS`. */
export interface OcGoPlanFields {
	label: string;
	usageKey: string;
}

/** Cache write is a scalar or a TTL map; the base (first) rate is the one mpc models. */
function writeRate(write: number | Record<string, number> | undefined): number | null {
	if (typeof write === "number") return write;
	if (write && typeof write === "object") {
		const first = Object.values(write)[0];
		return typeof first === "number" ? first : null;
	}
	return null;
}

/** Convert a `/zen/go/v1/models` payload into one plan's catalog entries. */
export function parseOcGoModels(payload: unknown, plan: OcGoPlanFields): CatalogEntry[] {
	const data = (payload as { data?: unknown } | null)?.data;
	if (!Array.isArray(data)) return [];
	const entries: CatalogEntry[] = [];

	for (const raw of data) {
		const model = raw as GoModel;
		if (!model || typeof model.id !== "string") continue;
		// The id, not the display name, is the stable key: names carry bake dates
		// (`DeepSeek V4.1 Flash 1017`) that would miss the CommandCode row.
		const key = normalizeKey(model.id);
		if (!key) continue;

		const text = model.cost?.text;
		const input = text?.input?.price;
		const output = text?.output?.price;
		if (typeof input !== "number" || typeof output !== "number") continue;

		const monthly = model.go?.monthly_usage;
		const allowance = monthly?.[plan.usageKey] ?? 0;
		// Free models publish null usage and zero rates. Their cache-write cell
		// used to be "-" in the table; on a free model the true rate is 0.
		const free = input === 0 && output === 0;
		entries.push({
			provider: "oc-go",
			plan: plan.label,
			key,
			name: displayName(model.name || model.id),
			pricing: {
				input,
				output,
				cacheRead: text?.input?.cache?.read ?? 0,
				cacheWrite: free ? 0 : writeRate(text?.input?.cache?.write),
			},
			allowance,
		});
	}
	return entries;
}
