import { normalizeKey } from "~/keys.ts";

/** Pure parser over one AA API page, for tests and the loader. */
export function parseAaApi(body: unknown): {
	intelligence: Map<string, number>;
	tps: Map<string, number>;
} {
	const root = (body ?? {}) as Record<string, unknown>;
	const rows = Array.isArray(root.data)
		? root.data
		: Array.isArray(body)
			? body
			: Object.values(root).filter((v) => v && typeof v === "object");
	const intelligence = new Map<string, number>();
	const tps = new Map<string, number>();

	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const record = row as Record<string, unknown>;
		const name = String(record.name ?? record.slug ?? record.id ?? "");
		const slug = typeof record.slug === "string" ? record.slug : undefined;
		const keys = [
			slug ? normalizeKey(slug) : "",
			normalizeKey(name),
		].filter(Boolean);
		if (keys.length === 0) continue;

		const iq = findNumber(record, /intelligence_index/i);
		if (iq !== null && iq > 0) {
			for (const k of keys) {
				if (!intelligence.has(k) || iq > (intelligence.get(k) ?? 0)) {
					intelligence.set(k, iq);
				}
			}
		}
		// 0 means "not benchmarked", not "zero tokens per second".
		const speed = findNumber(record, /tokens_per_second|(^|_)tps($|_)/i);
		if (speed !== null && speed > 0) {
			for (const k of keys) {
				if (!tps.has(k) || speed > (tps.get(k) ?? 0)) tps.set(k, speed);
			}
		}
	}
	return { intelligence, tps };
}

/** Depth-first search for the first finite number under a matching key. */
function findNumber(value: unknown, pattern: RegExp): number | null {
	if (!value || typeof value !== "object") return null;
	for (const [key, child] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (
			typeof child === "number" &&
			Number.isFinite(child) &&
			pattern.test(key)
		) {
			return child;
		}
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		const found = findNumber(child, pattern);
		if (found !== null) return found;
	}
	return null;
}
