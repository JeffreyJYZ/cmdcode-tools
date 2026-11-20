import { fetchText } from "#~/data/scrape/index.ts";
import { loadAa } from "#~/data/sources/aa.ts";
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
		for (const [name, score] of Object.entries(body as Record<string, unknown>)) {
			add(name, score);
		}
	}
	return scores;
}

async function loadFile(path: string): Promise<Map<string, number>> {
	const file = Bun.file(path);
	if (!(await file.exists())) throw new Error(`bench file not found: ${path}`);
	return parseJsonScores(await file.text());
}

async function loadUrl(url: string): Promise<Map<string, number>> {
	return parseJsonScores(await fetchText(url));
}

/** The footer label: counts always, the index version and a source problem when known. */
function aaLabel(data: BenchData, prefix?: string, notes: string[] = []): string {
	const parts = [`${data.intelligence.size} models`, `${data.tps.size} speed`];
	if (data.indexVersion) parts.push(`index ${data.indexVersion}`);
	const head = `Artificial Analysis (${prefix ? `${prefix}, ` : ""}${parts.join(", ")})`;
	return notes.length > 0 ? `${head} — ${notes.join("; ")}` : head;
}

export async function resolvePrimary(opts: AbilityOptions): Promise<Resolved> {
	const [scheme, arg] = opts.source.includes(":")
		? [opts.source.split(":")[0] ?? "", opts.source.slice(opts.source.indexOf(":") + 1)]
		: [opts.source, undefined];

	switch (scheme) {
		case "cc":
			return {
				scheme: "cc",
				data: await loadCc(),
				label: "CommandCode Intelligence",
			};
		case "aa-web": {
			// Keyless by definition: the package's manifest and page scrape cover
			// far more rows than the old models-page top-N ever did.
			const { data, notes } = await loadAa();
			return { scheme: "aa-web", data, label: aaLabel(data, "web", notes) };
		}
		case "aa": {
			const key = opts.key ?? process.env.AA_API_KEY;
			if (!key) {
				throw new Error("--bench aa needs a key: set AA_API_KEY or pass --aa-key");
			}
			// One load merges the API with the keyless sources, so a spent daily
			// quota degrades coverage (the label says so) instead of the run.
			const { data, notes } = await loadAa({ apiKey: key });
			if (data.intelligence.size === 0) {
				throw new Error(
					"Artificial Analysis returned no scores — check the key and response shape",
				);
			}
			return { scheme: "aa", data, label: aaLabel(data, undefined, notes) };
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
 * Artificial Analysis as a gap filler: the merged catalogue, which asks the API
 * when a key is available and reads the keyless sources otherwise.
 */
export async function loadAaFallback(
	opts: AbilityOptions,
): Promise<{ data: BenchData; how: string }> {
	const key = opts.key ?? process.env.AA_API_KEY;
	if (key) return { data: (await loadAa({ apiKey: key })).data, how: "AA API" };
	return { data: (await loadAa()).data, how: "AA keyless sources" };
}

export type { AbilityOptions, AbilityResult, AbilitySource, BenchData } from "./types.ts";
