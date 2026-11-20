import { describe, expect, test } from "bun:test";
import { discoverManifest, discoverManifests } from "#~/sources/discover.ts";

const html = await Bun.file(new URL("./homepage.txt", import.meta.url)).text();

describe("discoverManifest", () => {
	test("finds the manifest the homepage's RSC payload embeds", () => {
		// The saved page is still escaped (`\"manifest\"`), so discovery must decode the chunk.
		expect(html).toContain('\\"manifest\\"');
		const refs = discoverManifests(html);
		expect(refs).toHaveLength(1);
		const [ref] = refs;
		expect(ref?.url).toBe("https://artificialanalysis.ai/data/b2ca3023f67eb50f.txt");
		expect(ref?.key).toMatch(/^[0-9a-f]{64}$/);
		expect(discoverManifest(html)?.url).toBe(ref?.url);
	});

	test("a page with no manifest answers null instead of throwing", () => {
		const page = "<!doctype html><html><body><p>nothing here</p></body></html>";
		expect(discoverManifests(page)).toEqual([]);
		expect(discoverManifest(page)).toBeNull();
	});

	test("an escaped chunk still yields the real quotes", () => {
		const chunk = JSON.stringify(
			'"manifest":{"path":"/data/abc.txt","key":"a1b2c3d4e5f60718"}',
		);
		const page = `<script>self.__next_f.push([1,${chunk}])</script>`;
		expect(discoverManifest(page)).toEqual({
			url: "https://artificialanalysis.ai/data/abc.txt",
			key: "a1b2c3d4e5f60718",
		});
	});

	test("an unescaped page is read without the flight decoder", () => {
		const page =
			'<div data-x=\'{"manifest":{"path":"/data/raw.txt","key":"ab12cd34ef56ab78"}}\'></div>';
		expect(discoverManifest(page)?.url).toBe("https://artificialanalysis.ai/data/raw.txt");
	});

	test("duplicate references collapse and page order is kept", () => {
		const one = '"manifest":{"path":"/data/one.txt","key":"0011223344556677"}';
		const two = '"manifest":{"path":"/data/two.txt","key":"8899aabbccddeeff"}';
		const page = `${one} ${two} ${one}`;
		expect(discoverManifests(page).map((ref) => ref.url)).toEqual([
			"https://artificialanalysis.ai/data/one.txt",
			"https://artificialanalysis.ai/data/two.txt",
		]);
	});
});
