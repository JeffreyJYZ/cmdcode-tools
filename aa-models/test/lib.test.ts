import { afterEach, describe, expect, test } from "bun:test";
import { loadCatalogue } from "@jeffreyjyz/aa-models";
import { aaPage, readRows } from "./sources/page.ts";

// A trimmed live page: the leaderboard's `initialModels` array, which carries
// the scores this entry exists to hand out.
const page = aaPage(readRows("leaderboard.rows.json"));
const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("library entry", () => {
	test("resolves through the package name and loads against a stubbed fetch", async () => {
		const calls: string[] = [];
		globalThis.fetch = ((input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			const html =
				url.includes("/leaderboards/") || url.endsWith("/models") ? page : "<html></html>";
			return Promise.resolve(new Response(html));
		}) as typeof fetch;

		const catalogue = await loadCatalogue({ cacheTtlMs: 0, noCacheWrite: true });

		expect(catalogue.models.length).toBeGreaterThan(0);
		expect(catalogue.models.some((model) => model.keys.includes("claudesonnet55"))).toBe(true);
		// The homepage carried no manifest reference, so that source reports itself
		// as a note instead of failing the load — the entry never throws for one
		// dead source.
		expect(catalogue.notes.some((note) => note.startsWith("manifest:"))).toBe(true);
		expect(calls.length).toBeGreaterThan(0);
	});
});
