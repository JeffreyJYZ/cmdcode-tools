import { type Catalogue, loadCatalogue } from "@jeffreyjyz/aa-models";
import type { BenchData } from "#~/data/bench/types.ts";

export interface AaOptions {
	/** AA API key; absent means the keyless sources only. */
	apiKey?: string;
}

export interface AaLoad {
	data: BenchData;
	/** The package's per-source problems; empty when every source answered. */
	notes: string[];
}

/**
 * Artificial Analysis through `@jeffreyjyz/aa-models`, which merges the
 * encrypted manifest, both keyless pages and the paginated API into one `Model`
 * per release. The package publishes every join key a row answers to
 * (`model.keys`, the replacement for the local `aaKeyVariants`), so each is
 * mapped and the best figure per key wins: a lower score never overwrites a
 * higher one, and a listed-but-unmeasured model stays out of both maps.
 */
export function benchOf(catalogue: Catalogue): BenchData {
	const intelligence = new Map<string, number>();
	const tps = new Map<string, number>();
	for (const model of catalogue.models) {
		const score = model.intelligenceIndex;
		const speed = model.outputSpeed;
		for (const key of model.keys) {
			if (!key) continue;
			if (score !== null && score > (intelligence.get(key) ?? 0))
				intelligence.set(key, score);
			if (speed !== null && speed > (tps.get(key) ?? 0)) tps.set(key, speed);
		}
	}
	const data: BenchData = { intelligence, tps };
	if (catalogue.indexVersion) data.indexVersion = catalogue.indexVersion;
	return data;
}

/**
 * Live load, every run. `cacheTtlMs: 0` keeps the package's TTL cache out of
 * the path, matching mpc's rule that a dead source costs its columns, never a
 * stale value; the package's last-good remains a failure fallback, not a cache.
 *
 * `notes` are the package's per-source problems (a spent quota, a retired
 * path), which the footer label carries so a rejected key is never silent.
 */
export async function loadAa(options: AaOptions = {}): Promise<AaLoad> {
	const catalogue = await loadCatalogue({ apiKey: options.apiKey, cacheTtlMs: 0 });
	return { data: benchOf(catalogue), notes: catalogue.notes };
}
