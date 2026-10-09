import { loadAaApi } from "#~/data/sources/aa/api.ts";
import { loadCc } from "./cc.ts";
import { loadAaWebCached, loadFile, loadUrl } from "./store.ts";
import {
	type AbilityOptions,
	type BenchData,
	emptyData,
	type Resolved,
} from "./types.ts";

export async function resolvePrimary(opts: AbilityOptions): Promise<Resolved> {
	const [scheme, arg] = opts.source.includes(":")
		? [
				opts.source.split(":")[0] ?? "",
				opts.source.slice(opts.source.indexOf(":") + 1),
			]
		: [opts.source, undefined];

	switch (scheme) {
		case "cc":
			return {
				scheme: "cc",
				data: await loadCc(),
				label: "CommandCode Intelligence",
			};
		case "aa-web": {
			const data = emptyData();
			data.intelligence = await loadAaWebCached(Boolean(opts.refresh));
			return {
				scheme: "aa-web",
				data,
				label: "Artificial Analysis (web, partial)",
			};
		}
		case "aa": {
			const key = opts.key ?? process.env.AA_API_KEY;
			if (!key) {
				throw new Error(
					"--bench aa needs a key: set AA_API_KEY or pass --aa-key",
				);
			}
			const data = await loadAaApi(key);
			if (data.intelligence.size === 0) {
				throw new Error(
					"Artificial Analysis returned no scores — check the API key and response shape",
				);
			}
			return {
				scheme: "aa",
				data,
				label: `Artificial Analysis (${data.intelligence.size} models, ${data.tps.size} speed)`,
			};
		}
		case "file":
			if (!arg) throw new Error("--bench file:<path> needs a path");
			return {
				scheme: "file",
				data: { intelligence: await loadFile(arg), tps: new Map() },
				label: `bench file ${arg}`,
			};
		case "url":
			if (!arg) throw new Error("--bench url:<url> needs a url");
			return {
				scheme: "url",
				data: { intelligence: await loadUrl(arg), tps: new Map() },
				label: `bench ${arg}`,
			};
		default:
			throw new Error(
				`unknown --bench "${opts.source}" (cc | aa | aa-web | file:<path> | url:<url>)`,
			);
	}
}

/**
 * Keyless Artificial Analysis page scrape (partial — only the models AA embeds).
 */
export async function loadAaWeb(opts: AbilityOptions): Promise<BenchData> {
	const data = emptyData();
	data.intelligence = await loadAaWebCached(Boolean(opts.refresh));
	return data;
}

/**
 * Artificial Analysis as a gap filler: the full API when a key is available,
 * otherwise the keyless page scrape (partial).
 */
export async function loadAaFallback(
	opts: AbilityOptions,
): Promise<{ data: BenchData; how: string }> {
	const key = opts.key ?? process.env.AA_API_KEY;
	if (key) {
		try {
			return { data: await loadAaApi(key), how: "AA API" };
		} catch {
			// fall through to the scrape
		}
	}
	return { data: await loadAaWeb(opts), how: "AA web scrape" };
}

export type {
	AbilityOptions,
	AbilityResult,
	AbilitySource,
	BenchData,
} from "./types.ts";
