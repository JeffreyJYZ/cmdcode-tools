import { loadAaWeb } from "#~/data/sources/aa/web.ts";
import { loadCc } from "./cc.ts";
import { loadAaFallback, resolvePrimary } from "./resolve.ts";
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
 * Load benchmark scores, live, every run. The chosen source leads; unless
 * --no-fallback, any model it misses is filled from the other sources so a
 * model scored anywhere shows a value. Nothing is cached: a source that is down
 * costs the columns it alone supplies, never a stale value.
 */
export async function loadAbility(
	opts: AbilityOptions,
): Promise<AbilityResult> {
	const primary = await resolvePrimary(opts);
	// CommandCode and Artificial Analysis publish the same intelligence index, so
	// a CC primary normally needs no second round-trip. That premise only covered
	// the index though: CC's plan pages dropped their `Tok/s` column (Sep 2026),
	// so a CC primary with no speed values has to ask AA after all.
	const needsSpeed = primary.data.tps.size === 0;
	if (!opts.fallback || (primary.scheme === "cc" && !needsSpeed)) {
		return { ...primary.data, label: primary.label };
	}

	const fills: string[] = [];
	// The API leads, so give the same benchmark's keyless page scrape a second look.
	if (primary.scheme === "aa") {
		const web = await loadAaWeb();
		const added =
			merge(primary.data.intelligence, web.intelligence, opts.keys) +
			merge(primary.data.tps, web.tps, opts.keys);
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
