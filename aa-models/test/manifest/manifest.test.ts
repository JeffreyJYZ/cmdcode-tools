import { describe, expect, test } from "bun:test";
import { decryptManifest } from "#~/sources/discover.ts";
import { loadManifest, parseManifest } from "#~/sources/manifest.ts";

/** The key the fixture was sealed with; see `scripts/fetch-fixtures.ts`. */
const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const here = (name: string) => new URL(`./${name}`, import.meta.url);

async function payload(): Promise<unknown> {
	const bytes = new Uint8Array(await Bun.file(here("payload.bin")).arrayBuffer());
	return decryptManifest(bytes, KEY);
}

const models = parseManifest(await payload());
const bySlug = new Map(models.map((model) => [model.slug, model]));

describe("decrypt + parse the encrypted fixture", () => {
	test("one row per release slug, effort variants collapsed", () => {
		expect(models.map((model) => model.slug).sort()).toEqual([
			"agnes-2-5-pro-beta",
			"claude-4-5-haiku",
		]);
		const haiku = bySlug.get("claude-4-5-haiku");
		expect(haiku?.name).toBe("Claude 4.5 Haiku");
		expect(haiku?.creator).toBe("Anthropic");
		expect(haiku?.release).toEqual({
			slug: "claude-4-5-haiku",
			name: "Claude 4.5 Haiku",
			date: "2025-10-15",
		});
		expect(haiku?.intelligenceIndex).toBeCloseTo(7.4303, 3);
		expect(haiku?.variants).toEqual([
			{
				slug: "claude-4-5-haiku",
				label: "Non-reasoning",
				intelligenceIndex: null,
				outputSpeed: null,
			},
		]);
	});

	test("every upstream slug stays matchable as a key", () => {
		const haiku = bySlug.get("claude-4-5-haiku");
		expect(haiku?.keys).toContain("claude45haiku");
		expect(haiku?.keys).toContain("claude45haikureasoning");
	});

	test("only published fields are filled; the rest stay null", () => {
		const haiku = bySlug.get("claude-4-5-haiku");
		expect(haiku?.sources).toEqual(["manifest"]);
		expect(haiku?.price).toBeNull();
		expect(haiku?.outputSpeed).toBeNull();
		expect(haiku?.latency).toBeNull();
		expect(haiku?.contextWindow).toBeNull();
		expect(haiku?.maxOutputTokens).toBeNull();
		expect(haiku?.openWeights).toBe(false);
		expect(haiku?.modalities.input).toContain("image");
		expect(haiku?.reasoning.supported).toBe(true);
	});

	test("a row with no index keeps null, never 0", () => {
		expect(bySlug.get("agnes-2-5-pro-beta")?.intelligenceIndex).toBeNull();
	});

	test("unmodelled scalars land under their AA dot-path", () => {
		const haiku = bySlug.get("claude-4-5-haiku");
		expect(haiku?.evals.score).toBeGreaterThan(0);
		expect(haiku?.evals["briefcaseEloInterval.lower"]).toBeCloseTo(609.2, 1);
		expect(haiku?.evals).not.toHaveProperty("intelligenceIndex");
	});
});

describe("loadManifest", () => {
	const key = KEY;
	const homeUrl = "https://example.test/home";

	test("fetches, discovers, decrypts and parses with no network", async () => {
		const bytes = new Uint8Array(await Bun.file(here("payload.bin")).arrayBuffer());
		const page = pageWith(`/data/fixture.txt`, key);
		const calls: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url === homeUrl) return new Response(page, { status: 200 });
			return new Response(bytes, { status: 200 });
		}) as unknown as typeof fetch;

		const result = await loadManifest({ fetchImpl, homeUrl });
		expect(result.notes).toEqual([]);
		expect(result.models).toHaveLength(models.length);
		expect(calls).toHaveLength(2);
	});

	test("a 4xx is reported in notes and never retried", async () => {
		const calls: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			calls.push(String(input));
			return new Response("gone", { status: 404 });
		}) as unknown as typeof fetch;

		const result = await loadManifest({ fetchImpl, homeUrl });
		expect(result.models).toEqual([]);
		expect(result.notes[0]).toContain("HTTP 404");
		expect(calls).toHaveLength(1);
	});

	test("a page with no reference is a note, not a crash", async () => {
		const fetchImpl = (async () =>
			new Response("<html></html>", { status: 200 })) as unknown as typeof fetch;
		const result = await loadManifest({ fetchImpl, homeUrl });
		expect(result.models).toEqual([]);
		expect(result.notes[0]).toContain("no reference");
	});

	test("a payload that will not decrypt is a note", async () => {
		const page = pageWith("/data/fixture.txt", "00".repeat(32));
		const fetchImpl = (async (input: string | URL | Request) =>
			String(input) === homeUrl
				? new Response(page, { status: 200 })
				: new Response(new Uint8Array(32), { status: 200 })) as unknown as typeof fetch;
		const result = await loadManifest({ fetchImpl, homeUrl });
		expect(result.models).toEqual([]);
		expect(result.notes[0]).toContain("/data/fixture.txt");
	});
});

/** A one-chunk page advertising a manifest, the way the real homepage does. */
function pageWith(path: string, keyHex: string): string {
	const flight = JSON.stringify(`"manifest":{"path":"${path}","key":"${keyHex}"}`);
	return `<script>self.__next_f.push([1,${flight}])</script>`;
}
