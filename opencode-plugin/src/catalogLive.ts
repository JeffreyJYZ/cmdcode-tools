// Live catalogue: prices, context windows and efforts fetched at runtime.
//
// The listing API (`/provider/v1/models`) carries ids, names and context only —
// no rates, no capabilities. The published CLI's `models.md` carries all of it,
// so it is fetched from the npm CDN and merged over the baked snapshot, which
// stays as the offline/first-run fallback. Without this a released plugin shows
// yesterday's prices until the next release.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CatalogEntry, ModelCost } from "./catalog";
import {
	CATALOG_VERSION,
	inputModalities,
	isReasoningModel,
	MODEL_CATALOG,
	minPlan as bakedMinPlan,
	modelContext,
	modelCost,
	supportsImage,
} from "./catalog";
import { CACHE_DIR } from "./constants/paths";
import { CATALOG_LIVE_TTL_MS, CATALOG_LIVE_TIMEOUT_MS } from "./constants/timing";

/** A live row: everything models.md carries except modalities, which only the
 * CLI bundle has and stays baked. */
export type LiveEntry = Omit<CatalogEntry, "modalities">;

export type LiveCatalog = {
	fetchedAt: number;
	/** CLI version the document came from, for diagnostics. */
	version: string;
	entries: Record<string, LiveEntry>;
};

const CDNS = ["https://cdn.jsdelivr.net/npm", "https://unpkg.com"];
const DOC = (cdn: string) =>
	`${cdn}/command-code@latest/dist/bundled/command-code-knowledge/reference/models.md`;
const LIVE_FILE = "catalog-live.json";

/** Same shape the build-time extractor matches, so live and baked parse alike:
 * `$0.15/$0.6 · cache $0.003` (and `(write $6.25)` for Anthropic models). */
const RATE_RE = /^\$([\d.]+)\/\$([\d.]+)\s*·\s*cache\s*\$([\d.]+)(?:\s*\(write\s*\$([\d.]+)\))?$/;
const PLAN_NAMES: Record<string, string> = {
	free: "Free",
	go: "Go",
	goat: "GOAT",
	pro: "Pro",
	teampro: "Team Pro",
};

/** "1M" / "1.05M" / "256K" / "1050000" → tokens. */
export function parseCount(raw: string): number {
	const m = raw.trim().match(/^([\d.]+)\s*([MK])?$/i);
	if (!m) return 0;
	const value = Number(m[1]);
	if (!Number.isFinite(value)) return 0;
	const unit = (m[2] ?? "").toUpperCase();
	return Math.round(value * (unit === "M" ? 1_000_000 : unit === "K" ? 1000 : 1));
}

/** "Go and above" → "Go"; "—" → null. */
export function normalizeMinPlan(raw: string | undefined): string | null {
	const text = (raw ?? "")
		.trim()
		.replace(/\s+and above$/i, "")
		.toLowerCase();
	if (!text || text === "—" || text === "-") return null;
	return PLAN_NAMES[text] ?? null;
}

/** Parse the published models.md table. Rows that fail the rate match are dropped,
 * exactly as the build-time extractor does, so live and baked agree. */
export function parseModelsMd(md: string): Record<string, LiveEntry> {
	const out: Record<string, LiveEntry> = {};
	for (const line of md.split("\n")) {
		const cells = line.split("|").map((c) => c.trim());
		// ["", "`id`", name, context, efforts, rate, minPlan, bestFor, ""]
		if (cells.length < 8 || !cells[1]?.startsWith("`") || !cells[1]?.endsWith("`")) continue;
		const rate = cells[5]?.match(RATE_RE);
		if (!rate) continue;
		const [, input, output, cacheRead, cacheWrite] = rate;
		const effortsRaw = (cells[4] ?? "").trim();
		out[cells[1].slice(1, -1)] = {
			name: (cells[2] ?? "").trim(),
			context: parseCount(cells[3] ?? ""),
			efforts:
				!effortsRaw || effortsRaw === "—" || effortsRaw === "-"
					? null
					: effortsRaw
							.split(",")
							.map((e) => e.trim())
							.filter(Boolean),
			cost: {
				input: Number(input),
				output: Number(output),
				cacheRead: Number(cacheRead),
				cacheWrite: cacheWrite === undefined ? 0 : Number(cacheWrite),
			},
			minPlan: normalizeMinPlan(cells[6]),
		};
	}
	return out;
}

let live: Record<string, LiveEntry> | null = null;
let liveFetchedAt = 0;

/** Install a live table. Exported for tests; production goes through `refreshLiveCatalog`. */
export function applyLiveCatalog(
	entries: Record<string, LiveEntry> | null,
	fetchedAt = Date.now(),
) {
	live = entries && Object.keys(entries).length > 0 ? entries : null;
	liveFetchedAt = live ? fetchedAt : 0;
}

/** Provenance for the sidebar/logs: baked snapshot or a live overlay. */
export function catalogSource(): { kind: "baked" | "live"; version: string; ageMs: number } {
	if (!live) return { kind: "baked", version: CATALOG_VERSION, ageMs: 0 };
	return { kind: "live", version: CATALOG_VERSION, ageMs: Date.now() - liveFetchedAt };
}

/** Live wins field-by-field; a model the document omits keeps its baked row, so a
 * partial or gated document can never delete a model. */
function entry(id: string): Partial<CatalogEntry> {
	return live?.[id] ?? MODEL_CATALOG[id] ?? {};
}

export function liveContext(id: string): number | undefined {
	const value = entry(id).context;
	return value && value > 0 ? value : modelContext(id);
}

export function liveCost(id: string): ModelCost | undefined {
	return live?.[id]?.cost ?? modelCost(id);
}

export function liveMinPlan(id: string): string | null {
	const plan = live?.[id]?.minPlan;
	return plan === undefined ? bakedMinPlan(id) : plan;
}

export function liveEfforts(id: string): readonly string[] | null | undefined {
	return live?.[id]?.efforts ?? MODEL_CATALOG[id]?.efforts;
}

export function liveReasoningVariants(
	id: string,
): Record<string, { reasoningEffort: string }> | undefined {
	const efforts = liveEfforts(id);
	if (!efforts || efforts.length === 0) return undefined;
	return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]));
}

export function liveIsReasoningModel(id: string): boolean {
	const efforts = liveEfforts(id);
	if (efforts === undefined) return isReasoningModel(id);
	return Array.isArray(efforts) && efforts.length > 0;
}

// Modalities only exist in the CLI bundle, which is far too large to fetch at
// runtime, so they stay exactly as the build-time extractor found them.
export { inputModalities, supportsImage };

function livePath(): string {
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, CACHE_DIR, LIVE_FILE);
}

async function readDisk(): Promise<LiveCatalog | undefined> {
	try {
		const parsed = JSON.parse(await readFile(livePath(), "utf8")) as LiveCatalog;
		if (!parsed.entries || typeof parsed.fetchedAt !== "number") return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

async function writeDisk(catalog: LiveCatalog): Promise<void> {
	try {
		const path = livePath();
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, JSON.stringify(catalog));
	} catch {
		// cache is best-effort
	}
}

async function fetchDoc(): Promise<string | undefined> {
	for (const cdn of CDNS) {
		try {
			const response = await fetch(DOC(cdn), {
				signal: AbortSignal.timeout(CATALOG_LIVE_TIMEOUT_MS),
			});
			if (!response.ok) continue;
			const body = await response.text();
			if (body.includes("$/1M")) return body;
		} catch {
			// next CDN
		}
	}
	return undefined;
}

/**
 * Load the live catalogue: disk cache when fresh, else fetch and rewrite it. Any
 * failure leaves the baked snapshot in place — an outage must never blank prices.
 * Never throws.
 */
export async function refreshLiveCatalog(
	options: { force?: boolean } = {},
): Promise<"disk" | "fetch" | "baked"> {
	const cached = await readDisk();
	if (cached && !options.force && Date.now() - cached.fetchedAt < CATALOG_LIVE_TTL_MS) {
		applyLiveCatalog(cached.entries, cached.fetchedAt);
		return "disk";
	}
	const doc = await fetchDoc();
	if (!doc) {
		if (cached) applyLiveCatalog(cached.entries, cached.fetchedAt);
		return "baked";
	}
	const entries = parseModelsMd(doc);
	if (Object.keys(entries).length === 0) {
		if (cached) applyLiveCatalog(cached.entries, cached.fetchedAt);
		return "baked";
	}
	const version = String(CATALOG_VERSION);
	applyLiveCatalog(entries);
	await writeDisk({ fetchedAt: Date.now(), version, entries });
	return "fetch";
}

/** Startup path: apply the disk copy synchronously-immediately, then refresh in
 * the background so nothing waits on the network. */
export async function primeLiveCatalog(): Promise<"disk" | "fetch" | "baked"> {
	const cached = await readDisk();
	if (cached) applyLiveCatalog(cached.entries, cached.fetchedAt);
	return refreshLiveCatalog();
}

/** Path for tests and diagnostics. */
export function liveCatalogPath(): string {
	return livePath();
}
