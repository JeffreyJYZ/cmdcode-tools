import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "#~/model.ts";
import { type LastGood, hasApiSpeed } from "./lastGood.ts";
import { offerSpeed } from "./speed.ts";

/**
 * The store mpc kept before the package took over AA access.
 *
 * A release must keep reading what the previous version wrote: that file is a
 * real keyed API payload (169 scores, 439 speeds) while the package's own store
 * can only hold the keyless pages once the free tier is spent. It is read, never
 * rewritten or deleted — another tool may still own it.
 *
 * Its shape is `{ fetchedAt, intelligence: [key, score][], tps: [key, speed][] }`
 * with mpc's canonical, dashless keys, so values are joined onto a model through
 * `model.keys`. Every figure in it came from the API, so each is tagged `api`.
 */
export interface MpcStore {
	fetchedAt: number;
	/** `[key, tokens per second]`, from `performance.median_output_tokens_per_second`. */
	speeds: Array<[string, number]>;
	/** `[key, Intelligence Index]`. */
	scores: Array<[string, number]>;
}

/** `$AA_LEGACY_DIR`, else `$XDG_CACHE_HOME/mpc`, else `~/.cache/mpc` — mpc's own cache. */
export function mpcStoreDir(): string {
	const explicit = process.env.AA_LEGACY_DIR;
	if (explicit) return explicit;
	return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "mpc");
}

export function mpcStorePath(): string {
	return join(mpcStoreDir(), "aa-last-good.json");
}

function pairs(value: unknown): Array<[string, number]> {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is [string, number] =>
			Array.isArray(row) &&
			typeof row[0] === "string" &&
			row[0].length > 0 &&
			typeof row[1] === "number" &&
			Number.isFinite(row[1]),
	);
}

/** A missing or malformed legacy file is `undefined`, never a throw. */
export async function readMpcStore(): Promise<MpcStore | undefined> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(mpcStorePath(), "utf8"));
	} catch {
		return undefined;
	}
	const file = (parsed ?? {}) as Partial<Record<"fetchedAt" | "intelligence" | "tps", unknown>>;
	const speeds = pairs(file.tps);
	if (speeds.length === 0) return undefined;
	return {
		fetchedAt: typeof file.fetchedAt === "number" ? file.fetchedAt : Date.now(),
		speeds,
		scores: pairs(file.intelligence),
	};
}

/** The best value any of a model's keys answers to in one flat key map. */
function best(map: Map<string, number>, keys: string[]): number | null {
	let out: number | null = null;
	for (const key of keys) {
		const value = map.get(key);
		if (value === undefined) continue;
		out = out === null ? value : Math.max(out, value);
	}
	return out;
}

/**
 * Merge the legacy figures into `models` under the tier rule: a speed enters as
 * `api`, so it outranks a page aggregate but never displaces a live api figure,
 * and a score fills a blank only. Mutates the rows and counts what it took.
 */
export function applyMpcStore(
	models: Model[],
	store: MpcStore,
): { speeds: number; scores: number } {
	const speeds = new Map(store.speeds);
	const scores = new Map(store.scores);
	let taken = 0;
	let scored = 0;
	for (const model of models) {
		if (offerSpeed(model, best(speeds, model.keys), "api")) taken++;
		if (model.intelligenceIndex !== null) continue;
		const score = best(scores, model.keys);
		if (score === null) continue;
		model.intelligenceIndex = score;
		scored++;
	}
	return { speeds: taken, scores: scored };
}

/**
 * Read the legacy store once, when neither this run nor the fallback already
 * holds an api-tier speed. It repairs the fallback (`stored`) and, with no store
 * yet, the live rows; the tier rule above means a live api figure is never
 * displaced and a page aggregate always is. Idempotent: once the store carries
 * an api tier the legacy file is not read again.
 */
export async function importMpcStore(
	models: Model[],
	stored: LastGood | undefined,
): Promise<{ note: string; repaired: boolean } | undefined> {
	if (stored && hasApiSpeed(stored.models)) return undefined;
	const legacy = await readMpcStore();
	if (!legacy) return undefined;
	const applied = stored ? applyMpcStore(stored.models, legacy) : applyMpcStore(models, legacy);
	if (applied.speeds === 0 && applied.scores === 0) return undefined;
	return {
		note: `migrated ${applied.speeds} api-tier speeds and ${applied.scores} scores from ${mpcStorePath()}`,
		repaired: stored !== undefined,
	};
}
