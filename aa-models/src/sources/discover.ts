/** Find and decode the encrypted data manifests a Next.js page embeds in its RSC payload. */
import { createDecipheriv, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { decodeFlight } from "#~/sources/flight.ts";

export interface ManifestRef {
	url: string;
	key: string;
}

export const HOME_URL = "https://artificialanalysis.ai/";
const USER_AGENT = "aa-models/0.1.0 (+https://github.com/JeffreyJYZ/cmdcode-tools)";
const TIMEOUT_MS = 20_000;

/** `manifest:{path,key}` with whitespace tolerated; the key is lowercase hex. */
const MANIFEST =
	/"manifest"\s*:\s*\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"key"\s*:\s*"([0-9a-fA-F]{16,})"\s*\}/g;

/** Every distinct manifest the page references, in page order. Empty when none. */
export function discoverManifests(html: string): ManifestRef[] {
	const seen = new Set<string>();
	const found: ManifestRef[] = [];
	const text = decodeFlight(html) || html;
	for (const match of text.matchAll(MANIFEST)) {
		const path = match[1];
		const key = match[2];
		if (path === undefined || key === undefined) continue;
		const url = resolve(path);
		if (seen.has(url)) continue;
		seen.add(url);
		found.push({ url, key: key.toLowerCase() });
	}
	return found;
}

/**
 * The first reference on the page. A page embeds several (one per chart), so
 * callers that need the model catalogue probe each: see `loadManifest`.
 */
export function discoverManifest(html: string): ManifestRef | null {
	return discoverManifests(html)[0] ?? null;
}

/** The IV is the first 12 bytes of SHA-256(key); the GCM tag rides at the end of the blob. */
export function manifestIv(keyHex: string): Uint8Array {
	return createHash("sha256").update(Buffer.from(keyHex, "hex")).digest().subarray(0, 12);
}

/** AES-GCM decrypt, gunzip, JSON parse. Throws on a bad key or payload. */
export function decryptManifest(blob: Uint8Array, keyHex: string): unknown {
	const key = Buffer.from(keyHex, "hex");
	if (key.length !== 32) throw new Error(`manifest key must be 32 bytes, got ${key.length}`);
	if (blob.byteLength <= 16) throw new Error("manifest payload is too short to carry a GCM tag");
	const body = Buffer.from(blob.subarray(0, blob.byteLength - 16));
	const tag = Buffer.from(blob.subarray(blob.byteLength - 16));
	const decipher = createDecipheriv("aes-256-gcm", key, manifestIv(keyHex));
	decipher.setAuthTag(tag);
	const plain = Buffer.concat([decipher.update(body), decipher.final()]);
	return JSON.parse(gunzipSync(plain).toString("utf8"));
}

/** One retry on a transport or 5xx fault; a 4xx is the server's answer and is never retried. */
export async function request(
	url: string,
	fetchImpl: typeof fetch,
	accept: string,
): Promise<ArrayBuffer> {
	let said = "request never ran";
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const response = await fetchImpl(url, {
				headers: { "user-agent": USER_AGENT, accept },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (response.ok) return await response.arrayBuffer();
			said = `HTTP ${response.status}`;
			if (response.status >= 400 && response.status < 500) break;
		} catch (error) {
			said = error instanceof Error ? error.message : String(error);
		}
	}
	throw new Error(`failed: ${said}`);
}

function resolve(path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	try {
		return new URL(path, HOME_URL).toString();
	} catch {
		return path;
	}
}
