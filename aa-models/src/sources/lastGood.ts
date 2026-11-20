import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Model } from "#~/model.ts";
import { offerSpeed } from "./speed.ts";

/**
 * Last-good catalogue: a failure fallback, not a TTL cache.
 *
 * Written only after a load produced models, read only when every live source
 * failed, and labelled with its age so a replay is never mistaken for live data.
 * An empty answer is never written — one bad run must not poison every later run.
 *
 * The file carries its own identity (`LAST_GOOD_SCHEMA`/`LAST_GOOD_REVISION`, not
 * the TTL cache's) because each value now remembers its tier: a store with no
 * identity was written before `outputSpeedSource` existed, and its numbers came
 * from the keyless pages alone. That is read as the page tier, never as unknown,
 * or a later merge could not rank it.
 */
export interface LastGood {
	fetchedAt: number;
	models: Model[];
}

export const LAST_GOOD_SCHEMA = "aa-models/last-good/1";
/** Bump by hand when what a stored model means changes (shape or merge rule). */
export const LAST_GOOD_REVISION = "1";

interface StoredFile extends LastGood {
	schema: string;
	revision: string;
	version: string;
}

/** `$AA_CACHE_DIR`, else `$XDG_CACHE_HOME/aa-models`, else `~/.cache/aa-models`. */
export function cacheDir(): string {
	const explicit = process.env.AA_CACHE_DIR;
	if (explicit) return explicit;
	return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "aa-models");
}

export function lastGoodPath(): string {
	return join(cacheDir(), "last-good.json");
}

/** A store with no identity predates the tier field; its speeds came from the pages. */
function tierOfLegacy(store: unknown): Model[] | undefined {
	const parsed = store as Partial<StoredFile> | null;
	if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) return undefined;
	if (typeof parsed.schema === "string") {
		if (parsed.schema !== LAST_GOOD_SCHEMA || parsed.revision !== LAST_GOOD_REVISION)
			return undefined;
		return parsed.models;
	}
	return parsed.models.map((model) =>
		model.outputSpeed !== null && !model.outputSpeedSource
			? { ...model, outputSpeedSource: "page" }
			: model,
	);
}

export async function readLastGood(): Promise<LastGood | undefined> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(lastGoodPath(), "utf8"));
	} catch {
		return undefined;
	}
	const models = tierOfLegacy(parsed);
	if (!models) return undefined;
	const file = parsed as Partial<StoredFile>;
	return {
		fetchedAt: typeof file.fetchedAt === "number" ? file.fetchedAt : Date.now(),
		models,
	};
}

export async function writeLastGood(
	models: Model[],
	options: { fetchedAt?: number } = {},
): Promise<void> {
	if (models.length === 0) return; // never persist an empty catalogue
	await writeJson("last-good.json", {
		schema: LAST_GOOD_SCHEMA,
		revision: LAST_GOOD_REVISION,
		version: pkg.version,
		fetchedAt: options.fetchedAt ?? Date.now(),
		models,
	});
}

/** True when the store already carries a figure the API alone can publish. */
export function hasApiSpeed(models: Model[]): boolean {
	return models.some((model) => model.outputSpeed !== null && model.outputSpeedSource === "api");
}

/**
 * The store a write should persist: the live rows with every tier the previous
 * store already knew, so a keyless run cannot overwrite an api-tier median with
 * a page-tier one. Live wins an equal tier; a lower tier never displaces it.
 */
export function mergeStore(live: Model[], stored: Model[]): Model[] {
	const bySlug = new Map(stored.map((model) => [model.slug, model]));
	const byKey = new Map<string, Model>();
	for (const model of stored)
		for (const key of model.keys) if (!byKey.has(key)) byKey.set(key, model);
	return live.map((model) => {
		const copy = { ...model };
		const previous =
			bySlug.get(model.slug) ?? model.keys.map((key) => byKey.get(key)).find(Boolean);
		if (!previous) return copy;
		offerSpeed(copy, previous.outputSpeed, previous.outputSpeedSource ?? null);
		copy.intelligenceIndex ??= previous.intelligenceIndex;
		return copy;
	});
}

/** "just now" / "12m" / "5h" / "3d" — a bare bucket, for `older than the TTL (3h)`. */
export function ageLabel(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 90) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * The same age as a sentence fragment: "just now", "12m old", "3h old".
 * `just now` takes no `old`, or the label reads "just now old".
 */
export function agePhrase(ms: number): string {
	const label = ageLabel(ms);
	return label === "just now" ? label : `${label} old`;
}

/** The replay label: an age, so stored data is never read as a live figure. */
export function lastGoodNote(stored: LastGood): string {
	return `last good, ${agePhrase(Date.now() - stored.fetchedAt)}`;
}

/** Best effort: a read-only cache dir must not fail a run. */
export async function writeJson(name: string, body: unknown): Promise<void> {
	try {
		await mkdir(cacheDir(), { recursive: true });
		await writeFile(join(cacheDir(), name), JSON.stringify(body));
	} catch {
		// nothing to report: the catalogue itself is still valid
	}
}
