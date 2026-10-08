import { loadCc } from "./cc.ts";
import { loadAaFallback, loadAaWeb, resolvePrimary } from "./resolve.ts";
import { fillFromCache, readAbilityCache, writeAbilityCache } from "./store.ts";
import type { AbilityOptions, AbilityResult } from "./types.ts";

export type {
	AbilityOptions,
	AbilityResult,
	AbilitySource,
	BenchData,
} from "./types.ts";

function merge(
	into: Map<string, number>,
	from: Map<string, number>,
	keys?: Set<string>,
): number {
	let added = 0;
	for (const [key, score] of from) {
		if (keys && !keys.has(key)) continue;
		if (!into.has(key)) {
			into.set(key, score);
			added++;
		}
	}
	return added;
}

function prune(map: Map<string, number>, keys?: Set<string>): void {
	if (!keys) return;
	for (const key of [...map.keys()]) if (!keys.has(key)) map.delete(key);
}

/**
 * Load benchmark scores. The chosen source leads; unless --no-fallback, any
 * model it misses is filled from the other sources so a model scored anywhere
 * shows a value. The whole result is cached: a source that is down — or a page
 * that silently dropped a column — falls back to the last good run rather than
 * blanking a column.
 */
export async function loadAbility(
	opts: AbilityOptions,
): Promise<AbilityResult> {
	let live: AbilityResult;
	try {
		live = await loadLiveAbility(opts);
	} catch (error) {
		// Refresh must not strand the caller: an outage still has the cache.
		const cached = await readAbilityCache(false);
		if (!cached) throw error;
		return {
			...cached,
			label: "cached (benchmark sources unavailable)",
			note:
				error instanceof Error
					? error.message.slice(0, 120)
					: undefined,
		};
	}
	const cached = await readAbilityCache(Boolean(opts.refresh));
	const filled = cached ? fillFromCache(live, cached) : 0;
	await writeAbilityCache(live);
	if (filled === 0) return live;
	return {
		...live,
		note: [live.note, `${filled} values from the last cached run`]
			.filter(Boolean)
			.join(", "),
	};
}

async function loadLiveAbility(opts: AbilityOptions): Promise<AbilityResult> {
	const primary = await resolvePrimary(opts);
	// CommandCode and Artificial Analysis publish the same intelligence index, so
	// a CC primary normally needs no second round-trip. That premise only covered
	// the index though: CC's plan pages dropped their `Tok/s` column (Sep 2026),
	// so a CC primary with no speed values has to ask AA after all — otherwise
	// every model reports speed null and the consumers drop the row.
	const needsSpeed = primary.data.tps.size === 0;
	if (!opts.fallback || (primary.scheme === "cc" && !needsSpeed)) {
		return { ...primary.data, label: primary.label };
	}

	const fills: string[] = [];
	// The API leads, so give the same benchmark's keyless page scrape a second
	// look (cached, free when warm) before the cross-source fallback.
	if (primary.scheme === "aa") {
		const web = await loadAaWeb(opts);
		const added = merge(
			primary.data.intelligence,
			web.intelligence,
			opts.keys,
		);
		if (added > 0) fills.push(`${added} values from AA web scrape`);
	}
	{
		const cc = await loadCc();
		const added =
			merge(primary.data.intelligence, cc.intelligence, opts.keys) +
			merge(primary.data.tps, cc.tps, opts.keys);
		if (added > 0) fills.push(`${added} values from CommandCode`);
	}
	if (primary.scheme !== "aa-web" && primary.scheme !== "aa") {
		const fallback = await loadAaFallback(opts);
		const added =
			merge(
				primary.data.intelligence,
				fallback.data.intelligence,
				opts.keys,
			) + merge(primary.data.tps, fallback.data.tps, opts.keys);
		if (added > 0) {
			fills.push(
				`${added} values from Artificial Analysis (${fallback.how})`,
			);
		}
	}

	prune(primary.data.intelligence, opts.keys);
	prune(primary.data.tps, opts.keys);

	return {
		...primary.data,
		label: primary.label,
		note: fills.length > 0 ? `filled ${fills.join(", ")}` : undefined,
	};
}
