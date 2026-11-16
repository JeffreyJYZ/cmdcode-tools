// Last-good Artificial Analysis payload.
//
// The free tier allows 100 requests per 24 h, so a busy day exhausts it and every
// later run used to fall back to the partial page scrape — a third of the table
// losing its ability and speed mid-day. This keeps the last complete answer on
// disk and replays it ONLY when the live call fails; a fresh answer always wins,
// and the label says how old the replay is.
//
// It is a failure fallback, not a TTL cache: nothing is served from it while the
// API answers, and an empty result is never written (the bug that killed the old
// cache: one bad run persisted an empty set and every later run inherited it).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type LastGood = {
	fetchedAt: number;
	indexVersion?: string;
	intelligence: Array<[string, number]>;
	tps: Array<[string, number]>;
};

function path(): string {
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, "mpc", "aa-last-good.json");
}

export async function readLastGood(): Promise<LastGood | undefined> {
	try {
		const parsed = JSON.parse(await readFile(path(), "utf8")) as LastGood;
		if (!Array.isArray(parsed.intelligence) || parsed.intelligence.length === 0)
			return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export async function writeLastGood(data: {
	indexVersion?: string;
	intelligence: Map<string, number>;
	tps: Map<string, number>;
}): Promise<void> {
	if (data.intelligence.size === 0) return; // never persist an empty answer
	try {
		const target = path();
		await mkdir(join(target, ".."), { recursive: true });
		const body: LastGood = {
			fetchedAt: Date.now(),
			indexVersion: data.indexVersion,
			intelligence: [...data.intelligence.entries()],
			tps: [...data.tps.entries()],
		};
		await writeFile(target, JSON.stringify(body));
	} catch {
		// best effort: a read-only cache dir must not fail a run
	}
}

/** Rehydrate a stored payload into the loader's shape. */
export function hydrate(cached: LastGood): {
	intelligence: Map<string, number>;
	tps: Map<string, number>;
	indexVersion?: string;
} {
	return {
		intelligence: new Map(cached.intelligence),
		tps: new Map(cached.tps),
		indexVersion: cached.indexVersion,
	};
}

/** Cache path, for diagnostics and tests. */
export function lastGoodPath(): string {
	return path();
}
