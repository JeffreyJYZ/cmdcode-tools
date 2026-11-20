import { spyOn } from "bun:test";
import type { Model } from "#~/model.ts";
import type { Catalogue } from "#~/sources/index.ts";

/** A complete Model from the few fields a test cares about. */
export function model(partial: Partial<Model> & { slug: string }): Model {
	return {
		name: partial.slug,
		shortName: null,
		creator: null,
		release: { slug: null, name: null, date: null },
		keys: [partial.slug],
		intelligenceIndex: null,
		outputSpeed: null,
		latency: null,
		contextWindow: null,
		maxOutputTokens: null,
		price: null,
		openWeights: null,
		modalities: { input: [], output: [] },
		reasoning: { supported: null, efforts: [] },
		evals: {},
		variants: [],
		sources: ["manifest"],
		...partial,
	};
}

export function catalogue(models: Model[], overrides: Partial<Catalogue> = {}): Catalogue {
	return {
		models,
		sources: ["manifest"],
		indexVersion: "v5.0.1",
		fetchedAt: "2026-11-20T00:00:00.000Z",
		stale: false,
		notes: [],
		...overrides,
	};
}

/** Capture console output for a run() that prints rather than returns rows. */
export function captureConsole(): { out: string[]; err: string[]; restore: () => void } {
	const out: string[] = [];
	const err: string[] = [];
	const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		out.push(args.map((arg) => String(arg)).join(" "));
	});
	const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		err.push(args.map((arg) => String(arg)).join(" "));
	});
	const restore = (): void => {
		log.mockRestore();
		error.mockRestore();
	};
	return { out, err, restore };
}
