/** Load AA's encrypted manifest: the full covered set, including unscored models. */
import { type Model, normalizeRows } from "#~/model.ts";
import { decryptManifest, discoverManifests, HOME_URL, request } from "./discover.ts";

export interface ManifestLoad {
	models: Model[];
	notes: string[];
}

export interface ManifestOptions {
	fetchImpl?: typeof fetch;
	homeUrl?: string;
}

/**
 * Fetch the homepage, then probe each manifest it embeds until one parses as the
 * model catalogue. Notes carry every failure; nothing throws past this boundary.
 */
export async function loadManifest(options: ManifestOptions = {}): Promise<ManifestLoad> {
	const fetchImpl = options.fetchImpl ?? fetch;
	let html: string;
	try {
		const body = await request(options.homeUrl ?? HOME_URL, fetchImpl, "text/html");
		html = Buffer.from(body).toString("utf8");
	} catch (error) {
		return { models: [], notes: [`manifest: homepage ${reason(error)}`] };
	}
	const refs = discoverManifests(html);
	if (refs.length === 0) return { models: [], notes: ["manifest: no reference on the homepage"] };
	let last = "no candidate answered";
	for (const ref of refs) {
		try {
			const bytes = new Uint8Array(await request(ref.url, fetchImpl, "*/*"));
			const payload = decryptManifest(bytes, ref.key);
			const models = parseManifest(payload);
			if (models.length > 0) return { models, notes: [] };
			last = `${ref.url} carried no models`;
		} catch (error) {
			last = `${ref.url} ${reason(error)}`;
		}
	}
	return { models: [], notes: [`manifest: ${last}`] };
}

/**
 * The payload is `{ models: [...] }`, one row per AA listing (effort variants
 * included). Lane A's normalizer folds the variants and fills what AA published.
 */
export function parseManifest(payload: unknown): Model[] {
	if (payload === null || typeof payload !== "object") return [];
	const rows = (payload as { models?: unknown }).models;
	if (!Array.isArray(rows)) return [];
	return normalizeRows(rows, "manifest");
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
