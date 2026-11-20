import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "#~/model.ts";

/**
 * Last-good catalogue: a failure fallback, not a TTL cache.
 *
 * Written only after a load produced models, read only when every live source
 * failed, and labelled with its age so a replay is never mistaken for live data.
 * An empty answer is never written — one bad run must not poison every later run.
 */
export interface LastGood {
	fetchedAt: number;
	models: Model[];
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

export async function readLastGood(): Promise<LastGood | undefined> {
	try {
		const parsed = JSON.parse(await readFile(lastGoodPath(), "utf8")) as LastGood;
		if (!Array.isArray(parsed.models) || parsed.models.length === 0) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export async function writeLastGood(models: Model[]): Promise<void> {
	if (models.length === 0) return; // never persist an empty catalogue
	await writeJson("last-good.json", { fetchedAt: Date.now(), models });
}

/** "just now" / "12m" / "5h" / "3d". */
export function ageLabel(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 90) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** The replay label: an age, so stored data is never read as a live figure. */
export function lastGoodNote(stored: LastGood): string {
	return `last good, ${ageLabel(Date.now() - stored.fetchedAt)} old`;
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
