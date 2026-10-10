import { fetchText } from "#~/data/scrape/index.ts";
import { loadAaApi } from "#~/data/sources/aa/api.ts";
import { loadAaWeb } from "#~/data/sources/aa/web.ts";
import { normalizeKey } from "#~/keys.ts";
import { loadCc } from "./cc.ts";
import type { AbilityOptions, BenchData, Resolved } from "./types.ts";

/** Parse `{ model: score }` or `[{ model|name, score|value }]` JSON. */
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

async function loadFile(path: string): Promise<Map<string, number>> {
	const file = Bun.file(path);
	if (!(await file.exists()))
		throw new Error(`bench file not found: ${path}`);
	return parseJsonScores(await file.text());
}

async function loadUrl(url: string): Promise<Map<string, number>> {
	return parseJsonScores(await fetchText(url));
}

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
		case "aa-web":
			return {
				scheme: "aa-web",
				data: await loadAaWeb(),
				label: "Artificial Analysis (web, partial)",
			};
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
	return { data: await loadAaWeb(), how: "AA web scrape" };
}

export type {
	AbilityOptions,
	AbilityResult,
	AbilitySource,
	BenchData,
} from "./types.ts";
