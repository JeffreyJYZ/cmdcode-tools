import { CACHE_TTL_MS } from "~/constants/sources.ts";
import { fetchText } from "~/data/scrape/index.ts";
import { normalizeKey } from "~/keys.ts";

function parseJsonScores(text: string): Map<string, number> {
	const body = JSON.parse(text) as unknown;
	const scores = new Map<string, number>();
	const add = (name: unknown, score: unknown): void => {
		const key = typeof name === "string" ? normalizeKey(name) : "";
		const value = Number(score);
		if (key && Number.isFinite(value)) scores.set(key, value);
	};
	if (Array.isArray(body)) {
		for (const row of body) {
			const record = (row ?? {}) as Record<string, unknown>;
			add(record.model ?? record.name, record.score ?? record.value);
		}
	} else if (body && typeof body === "object") {
		for (const [name, score] of Object.entries(
			body as Record<string, unknown>,
		)) {
			add(name, score);
		}
	}
	return scores;
}

export async function loadFile(path: string): Promise<Map<string, number>> {
	const file = Bun.file(path);
	if (!(await file.exists()))
		throw new Error(`bench file not found: ${path}`);
	return parseJsonScores(await file.text());
}

export async function loadUrl(url: string): Promise<Map<string, number>> {
	return parseJsonScores(await fetchText(url));
}

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadAaWeb } from "~/data/sources/aa/web.ts";

function cachePath(): string {
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, "mpc", "ability-aa-web.json");
}

async function readCache(
	refresh: boolean,
): Promise<Map<string, number> | null> {
	if (refresh) return null;
	try {
		const file = Bun.file(cachePath());
		if (!(await file.exists())) return null;
		const raw = (await file.json()) as {
			fetchedAt?: number;
			scores?: Record<string, number>;
		};
		if (!raw.fetchedAt || Date.now() - raw.fetchedAt > CACHE_TTL_MS)
			return null;
		return new Map(Object.entries(raw.scores ?? {}));
	} catch {
		return null;
	}
}

async function writeCache(scores: Map<string, number>): Promise<void> {
	try {
		const path = cachePath();
		await mkdir(join(path, ".."), { recursive: true });
		await Bun.write(
			path,
			JSON.stringify({
				fetchedAt: Date.now(),
				scores: Object.fromEntries(scores),
			}),
		);
	} catch {
		// Cache is best-effort.
	}
}

/** Keyless AA page scrape, cached on disk. */
export async function loadAaWebCached(
	refresh: boolean,
): Promise<Map<string, number>> {
	const cached = await readCache(refresh);
	if (cached) return cached;
	const scores = await loadAaWeb();
	await writeCache(scores);
	return scores;
}

/**
 * The last good benchmark result, whole. The per-source caches above only cover
 * the AA page scrape; this one covers the result mpc actually returned, so a
 * source that is down (or a page that silently dropped a column, as the
 * CommandCode plan pages did with Tok/s) falls back to the scores we already
 * have instead of blanking the ability/tps columns.
 */
export interface CachedAbility {
	intelligence: Map<string, number>;
	tps: Map<string, number>;
}

function abilityCachePath(): string {
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, "mpc", "ability.json");
}

export async function readAbilityCache(
	refresh = false,
): Promise<CachedAbility | null> {
	if (refresh) return null;
	try {
		const file = Bun.file(abilityCachePath());
		if (!(await file.exists())) return null;
		const raw = (await file.json()) as {
			fetchedAt?: number;
			intelligence?: Record<string, number>;
			tps?: Record<string, number>;
		};
		if (!raw.fetchedAt || Date.now() - raw.fetchedAt > CACHE_TTL_MS)
			return null;
		return {
			intelligence: new Map(Object.entries(raw.intelligence ?? {})),
			tps: new Map(Object.entries(raw.tps ?? {})),
		};
	} catch {
		return null;
	}
}

export async function writeAbilityCache(data: CachedAbility): Promise<void> {
	try {
		const path = abilityCachePath();
		await mkdir(join(path, ".."), { recursive: true });
		await Bun.write(
			path,
			JSON.stringify({
				fetchedAt: Date.now(),
				intelligence: Object.fromEntries(data.intelligence),
				tps: Object.fromEntries(data.tps),
			}),
		);
	} catch {
		// Cache is best-effort.
	}
}

/** Fill keys the live run is missing from `cached`. Returns how many were added. */
export function fillFromCache(
	data: CachedAbility,
	cached: CachedAbility,
): number {
	let added = 0;
	for (const [into, from] of [
		[data.intelligence, cached.intelligence],
		[data.tps, cached.tps],
	] as const) {
		for (const [key, value] of from) {
			if (into.has(key)) continue;
			into.set(key, value);
			added++;
		}
	}
	return added;
}
