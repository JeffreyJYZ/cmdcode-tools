#!/usr/bin/env bun
/**
 * Maintainer script: refresh `test/manifest/` from the live site.
 *
 * Keeps the real encoding — the payload stays AES-GCM encrypted and gzipped —
 * so the offline tests still exercise discovery, decrypt and gunzip.
 * Run from `aa-models/`: `bun scripts/fetch-fixtures.ts`.
 */
import { createCipheriv, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { HOME_URL, decryptManifest, discoverManifests, request } from "../src/sources/discover.ts";

/** A fixture key, not a secret: it only protects bytes we wrote ourselves. */
const FIXTURE_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const OUT = new URL("../test/manifest/", import.meta.url);
const ROW_CAP = 8;

type Row = Record<string, unknown>;

const html = Buffer.from(await request(HOME_URL, fetch, "text/html")).toString("utf8");
const refs = discoverManifests(html);
if (refs.length === 0) throw new Error("no manifest reference on the homepage");
console.log(`homepage: ${html.length} bytes, ${refs.length} manifest candidates`);

await mkdir(OUT, { recursive: true });

const { payload, url } = await modelsPayload(refs);
await writeFile(new URL("homepage.txt", OUT), homepageFragment(html, url));
const rows = payload.models as Row[];
console.log(`models payload: ${rows.length} rows`);

const trimmed = trim(rows);
console.log(`fixture rows: ${trimmed.map((row) => row.slug).join(", ")}`);
const json = JSON.stringify({ models: trimmed });
await writeFile(new URL("payload.bin", OUT), seal(json, FIXTURE_KEY));
await writeFile(new URL("fixture.json", OUT), `${JSON.stringify(trimmed, null, "\t")}\n`);
console.log(
	`wrote test/manifest/{homepage.txt,payload.bin,fixture.json} (${json.length} JSON bytes)`,
);

/** Probe candidates until one decodes to the model catalogue. */
async function modelsPayload(candidates: ReturnType<typeof discoverManifests>) {
	let last = "no candidate answered";
	for (const ref of candidates) {
		try {
			const parsed = decryptManifest(
				new Uint8Array(await request(ref.url, fetch, "*/*")),
				ref.key,
			) as { models?: unknown };
			if (Array.isArray(parsed.models) && parsed.models.length > 0) {
				console.log(`catalogue candidate: ${ref.url}`);
				return { payload: parsed as { models: Row[] }, url: ref.url };
			}
			last = `${ref.url} carried ${describe(parsed)}`;
		} catch (error) {
			last = `${ref.url} ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	throw new Error(last);
}

/**
 * One real push chunk, cut to a window around the model manifest's path.
 * The window keeps the page's own escaping, so discovery is exercised for real.
 */
function homepageFragment(source: string, url: string): string {
	const path = new URL(url).pathname;
	const push = /<script>self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/g;
	for (const match of source.matchAll(push)) {
		const text = match[1];
		if (text === undefined) continue;
		const decoded = JSON.parse(text) as string;
		const at = decoded.indexOf(path);
		if (at < 0) continue;
		const window = decoded.slice(Math.max(0, at - 700), at + 500);
		const chunk = `<script>self.__next_f.push([1,${JSON.stringify(window)}])</script>`;
		return `<!doctype html>\n<html>\n<body>\n${chunk}\n</body>\n</html>\n`;
	}
	throw new Error("homepage carried no RSC chunk with the catalogue manifest");
}

/** One scored group with effort variants, one unscored group, capped. */
function trim(rows: Row[]): Row[] {
	const groups = new Map<string, Row[]>();
	for (const row of rows) {
		const key = String((row.release as Row | undefined)?.slug ?? row.slug);
		const group = groups.get(key);
		if (group === undefined) groups.set(key, [row]);
		else group.push(row);
	}
	const scored = [...groups]
		.sort(([a], [b]) => a.localeCompare(b))
		.find(
			([, group]) =>
				group.length > 1 && group.some((row) => typeof row.intelligenceIndex === "number"),
		);
	const unscored = [...groups]
		.sort(([a], [b]) => a.localeCompare(b))
		.find(([, group]) => !group.some((row) => typeof row.intelligenceIndex === "number"));
	const picked = [...(scored?.[1] ?? []), ...(unscored?.[1] ?? [])];
	return picked.slice(0, ROW_CAP);
}

function seal(json: string, keyHex: string): Uint8Array {
	const key = Buffer.from(keyHex, "hex");
	const iv = createHash("sha256").update(key).digest().subarray(0, 12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const plain = gzipSync(Buffer.from(json, "utf8"));
	const body = Buffer.concat([cipher.update(plain), cipher.final()]);
	return new Uint8Array(Buffer.concat([body, cipher.getAuthTag()]));
}

function describe(parsed: unknown): string {
	if (parsed === null || typeof parsed !== "object") return "not an object";
	return `keys ${Object.keys(parsed).slice(0, 4).join(",")}`;
}
