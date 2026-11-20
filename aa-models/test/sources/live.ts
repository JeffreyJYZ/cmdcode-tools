import type { Model } from "#~/model.ts";
import { aaPage, readRows } from "./page.ts";

/** A stubbed AA: three sources answering, no network. Shared by the loader tests. */
export const leaderboardPage = aaPage(readRows("leaderboard.rows.json"));

/** The key `test/manifest/payload.bin` was sealed with; see `scripts/fetch-fixtures.ts`. */
const MANIFEST_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const manifestPayload = new Uint8Array(
	await Bun.file(new URL("../manifest/payload.bin", import.meta.url)).arrayBuffer(),
);

/** The homepage advertising the sealed manifest, in one RSC chunk like AA's. */
function homePage(): string {
	const flight = JSON.stringify(
		`"manifest":{"path":"/data/fixture.txt","key":"${MANIFEST_KEY}"}`,
	);
	return `<script>self.__next_f.push([1,${flight}])</script>`;
}

/** Two API pages: `claude-opus-5-5` then `glm-5-3-flash`, each with a documented speed. */
export function apiPage(url: string): string {
	const page = Number(new URL(url).searchParams.get("page") ?? "1");
	const data =
		page === 1
			? [
					{
						name: "Claude Opus 5.5 (max)",
						slug: "claude-opus-5-5",
						evaluations: { artificial_analysis_intelligence_index: 57.6 },
						performance: { median_output_tokens_per_second: 88.4 },
					},
				]
			: [
					{
						name: "GLM-5.3 Flash (high)",
						slug: "glm-5-3-flash",
						evaluations: { artificial_analysis_intelligence_index: 30.5 },
						performance: { median_output_tokens_per_second: 72.85 },
					},
				];
	return JSON.stringify({
		intelligence_index_version: "v5.0.1",
		pagination: { page, has_more: page === 1 },
		data,
	});
}

/** Every source answering: homepage + manifest, both pages, and the API. */
export function healthy(url: string): Response {
	if (url === "https://artificialanalysis.ai/") return new Response(homePage());
	if (url.includes("/data/fixture.txt")) return new Response(manifestPayload);
	if (url.includes("/api/v2/")) return new Response(apiPage(url));
	return new Response(leaderboardPage);
}

/** Keyless: the pages answer, the API is never asked. */
export function keyless(url: string): Response {
	return url.includes("/api/v2/") ? new Response("", { status: 500 }) : healthy(url);
}

/** Install a stubbed `fetch`; the returned list records every URL it saw. */
export function stubFetch(handler: (url: string) => Response): string[] {
	const calls: string[] = [];
	globalThis.fetch = ((input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		return Promise.resolve(handler(url));
	}) as typeof fetch;
	return calls;
}

/** A stored row from an earlier run: only the fields the replay reads matter. */
export function stored(slug: string, extra: Partial<Model> = {}): Model {
	return {
		slug,
		name: slug,
		shortName: null,
		creator: null,
		release: { slug, name: slug, date: null },
		keys: [slug],
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
		sources: ["api"],
		...extra,
	};
}
