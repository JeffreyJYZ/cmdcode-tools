// Regenerates core/zen.json from OpenCode's own model list API.
//
//   bun scripts/extract-zen.ts                                  # live API
//   bun scripts/extract-zen.ts --go p.json --zen q.json [--docs go.mdx]
//
// Why the API and not the docs: the docs article used to carry the priced
// tables (monthly limit per plan), and `priced plan slot` scraping was the
// source of truth until Nov 2026. Upstream then moved the article
// (`services/www` -> `services/site`), dropped the priced tables, and told
// readers to use `GET /zen/go/v1/models` "for every field in the response,
// including Go's monthly usage limits". The endpoint is also the meter the
// user is actually billed against, so it wins wherever the two disagree.
// The docs markdown is still read for the two things the API does not carry:
// each plan's price and the window split (5h = 20%, weekly = 50%, monthly =
// 100%). A dead docs URL therefore degrades to a documented fallback with a
// warning instead of blocking the refresh, which is what kept the file a month
// stale in the first place.
//
// Two products, one file:
//   go  — the Go subscription, whose plans share one token price list but grant
//         each model a different monthly dollar limit. Rates live once under
//         `go.models`; the plan dimension lives under `go.plans.<id>
//         .allowanceByModel`. Plans are discovered from the payload's
//         `go.monthly_usage` keys (today "go", "go-plus", "go-teams").
//   zen — pay-as-you-go: $/1M rates only (no limits; you spend a balance).
//
// Membership is the endpoint's list. A model absent from it is retired and
// must not keep a limit, so the file is rebuilt whole and the run prints every
// id it added or dropped.
//
// Rate variants (peak/off-peak, context tiers) are kept as separate entries
// keyed by variant label, so a caller can pick the right one later. Only a
// time-of-day multiplier is a peak split; a `date` or `service_tier` one is a
// scheduled reprice or a different service tier and is left alone.
import { writeFile } from "node:fs/promises";

const GO_API = "https://opencode.ai/zen/go/v1/models";
const ZEN_API = "https://opencode.ai/zen/v1/models";
const GO_DOCS =
	"https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/content/console/go.mdx";
const OUT = new URL("../core/zen.json", import.meta.url).pathname;

/** The documented window split for Go, as fractions of a model's monthly limit. */
export const GO_WINDOW_SHARE = { fiveHour: 0.2, weekly: 0.5, monthly: 1 } as const;

/**
 * Plan prices, used only when the docs article cannot be read. Kept in step with
 * the article's plan table (Go $10/mo, Go Plus $40/mo, Go Teams $20/member/mo).
 * A miss prints a warning, so a silent drift is impossible.
 */
export const PLAN_PRICE_FALLBACK: Record<string, number> = {
	go: 10,
	"go-plus": 40,
	"go-teams": 20,
};

export interface RateVariant {
	/** "peak" | "off-peak" | null — the time-of-day split, when the model has one. */
	peak: "peak" | "off-peak" | null;
	/** Context tier ceiling in tokens (e.g. 272000): applies when input ≤ this. */
	tierMaxTokens: number | null;
	/** Context tier floor in tokens: applies when input is above it. */
	tierMinTokens: number | null;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ZenModel {
	id: string;
	name: string;
	variants: RateVariant[];
}

/** One Go plan: a price plus a monthly dollar limit per model id. */
export interface GoPlan {
	label: string;
	priceUsd: number;
	/** model id -> monthly dollar limit; a missing id is free/unlimited. */
	allowanceByModel: Record<string, number>;
}

export interface GoCatalogue {
	/** Where the limits and rates came from. */
	source: string;
	windowShare: typeof GO_WINDOW_SHARE;
	/** Token rates, shared across plans (pricing is the same for every plan). */
	models: ZenModel[];
	/** Keyed by plan slug ("go", "go-plus", "go-teams"); only the allowances differ. */
	plans: Record<string, GoPlan>;
}

export interface ZenCatalog {
	extractedAt: string;
	go: GoCatalogue;
	zen: { source: string; models: ZenModel[] };
}

interface CacheRates {
	read?: number;
	/** A scalar, or a TTL map (`{"30m": 0.25, "12h": 0.5}`). */
	write?: number | Record<string, number>;
}

interface Rate {
	price?: number;
	cache?: CacheRates;
	overrides?: Array<{ when?: { context?: { gt?: number } }; price?: number; cache?: CacheRates }>;
}

/** One entry of `GET /zen/go/v1/models` (the fields this file reads). */
export interface ApiModel {
	id: string;
	name?: string;
	cost?: {
		text?: { input?: Rate; output?: Rate };
		multipliers?: Array<{ when?: Record<string, unknown>; factor?: number }>;
	};
	go?: { monthly_usage?: Record<string, number | null> | null };
}

/** "Go Plus" -> "go-plus"; a stable key for the plan map and the `--plan` flag. */
export function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** "go-plus" -> "Go Plus", for a plan's display label. */
export function humanize(id: string): string {
	return id
		.split(/[-_]+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** Rates are money per 1M tokens: six decimals is well below any published rate. */
function round(rate: number): number {
	return Math.round(rate * 1e6) / 1e6;
}

/** Cache write is a scalar or a TTL map; the base (first) rate is the one we price. */
export function writeRate(write: number | Record<string, number> | undefined): number | null {
	if (typeof write === "number") return write;
	if (write && typeof write === "object") {
		const first = Object.values(write)[0];
		return typeof first === "number" ? first : null;
	}
	return null;
}

/** Context tiers are `overrides` keyed by `when.context.gt`, on input and/or output. */
function thresholds(input: Rate | undefined, output: Rate | undefined): number[] {
	const found = new Set<number>();
	for (const rate of [input, output]) {
		for (const override of rate?.overrides ?? []) {
			const gt = override.when?.context?.gt;
			if (typeof gt === "number") found.add(gt);
		}
	}
	return [...found].sort((a, b) => a - b);
}

/** A time-of-day multiplier's factor; `date`/`service_tier` multipliers are not peak. */
export function peakFactor(multipliers: unknown): number | null {
	if (!Array.isArray(multipliers)) return null;
	for (const multiplier of multipliers as Array<{
		when?: Record<string, unknown>;
		factor?: number;
	}>) {
		const when = multiplier.when ?? {};
		const days = when.utc_days as { in?: unknown } | undefined;
		const hours = when.any as unknown[] | undefined;
		if (!Array.isArray(days?.in) || !Array.isArray(hours)) continue;
		if (typeof multiplier.factor === "number" && multiplier.factor !== 1)
			return multiplier.factor;
	}
	return null;
}

/** One model's `cost.text` -> its rate variants (base tier, higher tiers, peak sheets). */
export function rateVariants(model: ApiModel): RateVariant[] {
	const text = model.cost?.text;
	const input = text?.input;
	const output = text?.output;
	if (typeof input?.price !== "number" || typeof output?.price !== "number") return [];

	const bounds = thresholds(input, output);
	/** One tier's rates; `gt` names the threshold whose override applies, if any. */
	const at = (gt: number | undefined, max: number | null, min: number | null): RateVariant => {
		// An override without `gt` must not answer the base tier's `undefined`.
		const override = (rate: Rate | undefined) =>
			gt === undefined
				? undefined
				: (rate?.overrides ?? []).find((o) => o.when?.context?.gt === gt);
		const inputOverride = override(input);
		const outputOverride = override(output);
		return {
			peak: null,
			tierMaxTokens: max,
			tierMinTokens: min,
			input: round(inputOverride?.price ?? input.price ?? 0),
			output: round(outputOverride?.price ?? output.price ?? 0),
			cacheRead: round(inputOverride?.cache?.read ?? input.cache?.read ?? 0),
			cacheWrite: round(writeRate(inputOverride?.cache?.write ?? input.cache?.write) ?? 0),
		};
	};

	const plain: RateVariant[] =
		bounds.length === 0
			? [at(undefined, null, null)]
			: [
					at(undefined, bounds[0] ?? null, null),
					...bounds.map((gt, i) => at(gt, bounds[i + 1] ?? null, gt)),
				];

	const factor = peakFactor(model.cost?.multipliers);
	if (factor === null) return plain;
	const scale = (v: RateVariant): RateVariant => ({
		...v,
		input: round(v.input * factor),
		output: round(v.output * factor),
		cacheRead: round(v.cacheRead * factor),
		cacheWrite: round(v.cacheWrite * factor),
	});
	return [
		...plain.map((v) => ({ ...v, peak: "off-peak" as const })),
		...plain.map((v) => ({ ...scale(v), peak: "peak" as const })),
	];
}

/** One API payload -> the catalogue's model list, sorted by id. */
export function parseModels(payload: unknown, label: string): ZenModel[] {
	const data = (payload as { data?: unknown } | null)?.data;
	if (!Array.isArray(data) || data.length === 0)
		throw new Error(`${label}: payload carries no models — endpoint shape changed`);
	const models: ZenModel[] = [];
	const unpriced: string[] = [];
	for (const raw of data) {
		const model = raw as ApiModel;
		if (!model || typeof model.id !== "string") continue;
		const variants = rateVariants(model);
		if (variants.length === 0) {
			unpriced.push(model.id);
			continue;
		}
		models.push({ id: model.id, name: model.name?.trim() || model.id, variants });
	}
	if (unpriced.length > 0)
		console.warn(
			`warning: ${label}: ${unpriced.length} models publish no text rates: ${unpriced.join(", ")}`,
		);
	return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** Every plan the payload's `go.monthly_usage` maps name, plus each one's allowances. */
export function parsePlans(payload: unknown, models: ZenModel[]): Record<string, GoPlan> {
	const byId = new Map<string, ApiModel>();
	for (const raw of (payload as { data?: unknown[] }).data ?? []) {
		const model = raw as ApiModel;
		if (model && typeof model.id === "string") byId.set(model.id, model);
	}
	const planIds = [
		...new Set(
			[...byId.values()].flatMap((m) =>
				Object.keys(m.go?.monthly_usage ?? {}).filter(
					(key) => typeof m.go?.monthly_usage?.[key] === "number",
				),
			),
		),
	].sort();
	if (planIds.length < 2)
		throw new Error(
			`expected one usage key per Go plan, found ${planIds.length} — endpoint shape changed`,
		);

	const plans: Record<string, GoPlan> = {};
	for (const id of planIds) {
		const allowanceByModel: Record<string, number> = {};
		for (const model of models) {
			const limit = byId.get(model.id)?.go?.monthly_usage?.[id];
			if (typeof limit === "number" && limit > 0) allowanceByModel[model.id] = limit;
		}
		if (Object.keys(allowanceByModel).length === 0)
			throw new Error(`plan "${id}" lists no per-model limits — endpoint shape changed`);
		plans[id] = { label: humanize(id), priceUsd: 0, allowanceByModel };
	}
	return plans;
}

/** Tables are pipe rows; a header row plus `|---|` separator precede the data. */
function tableRows(markdown: string): string[][] {
	const rows: string[][] = [];
	for (const line of markdown.split("\n")) {
		if (!line.trim().startsWith("|")) continue;
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((c) => c.replace(/[*`]/g, "").trim());
		if (cells.length === 0 || cells.every((c) => /^-+$/.test(c) || c === "")) continue;
		rows.push(cells);
	}
	return rows;
}

/**
 * `| Plan | Price | Included usage |` -> { go: 10, "go-plus": 40, "go-teams": 20 }.
 * Only the plan table names a price per month; other tables are skipped.
 */
export function parsePlanPrices(markdown: string): Map<string, number> {
	const prices = new Map<string, number>();
	for (const cells of tableRows(markdown)) {
		const [label = "", price = ""] = cells;
		const match = price.match(/\$([\d.]+)[^|]*\/\s*month/i);
		if (!label || !match) continue;
		prices.set(slugify(label), Number(match[1]));
	}
	return prices;
}

async function readSource(url: string, override?: string): Promise<string> {
	if (override) return Bun.file(override).text();
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.text();
}

/** The plan table is the only source of plan prices; a dead page is a warning, not a stop. */
async function planPrices(docsPath?: string): Promise<Map<string, number>> {
	try {
		const markdown = await readSource(GO_DOCS, docsPath);
		const prices = parsePlanPrices(markdown);
		if (prices.size >= 2) return prices;
		console.warn(`warning: ${GO_DOCS}: no plan price table found — using PLAN_PRICE_FALLBACK`);
	} catch (error) {
		console.warn(
			`warning: docs page unreadable (${(error as Error).message}) — using PLAN_PRICE_FALLBACK`,
		);
	}
	return new Map();
}

/** Every id added to or dropped from a catalogue, plus each Go limit that moved. */
function report(oldFile: ZenCatalog | null, catalog: ZenCatalog): void {
	if (!oldFile) {
		console.log(`  no previous core/zen.json; wrote ${catalog.go.models.length} go models`);
		return;
	}
	const diff = (before: string[], after: string[], what: string) => {
		const dropped = before.filter((id) => !after.includes(id));
		const added = after.filter((id) => !before.includes(id));
		if (dropped.length > 0) console.log(`  ${what} dropped: ${dropped.join(", ")}`);
		if (added.length > 0) console.log(`  ${what} added: ${added.join(", ")}`);
	};
	diff(
		oldFile.go.models.map((m) => m.id),
		catalog.go.models.map((m) => m.id),
		"go",
	);
	diff(
		oldFile.zen.models.map((m) => m.id),
		catalog.zen.models.map((m) => m.id),
		"zen",
	);
	for (const [planId, plan] of Object.entries(catalog.go.plans)) {
		const before = oldFile.go.plans[planId]?.allowanceByModel ?? {};
		const moved = Object.entries(plan.allowanceByModel)
			.filter(([id, limit]) => before[id] !== undefined && before[id] !== limit)
			.map(([id, limit]) => `${id} ${before[id]} -> ${limit}`);
		if (moved.length > 0) console.log(`  ${planId} limits moved: ${moved.join(", ")}`);
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const [goText, zenText, prices] = await Promise.all([
		readSource(GO_API, value("--go")),
		readSource(ZEN_API, value("--zen")),
		planPrices(value("--docs")),
	]);
	const goPayload = JSON.parse(goText);
	const zenPayload = JSON.parse(zenText);

	const goModels = parseModels(goPayload, "go");
	const plans = parsePlans(goPayload, goModels);
	for (const [id, plan] of Object.entries(plans)) {
		const price = prices.get(id) ?? PLAN_PRICE_FALLBACK[id];
		if (price === undefined)
			console.warn(
				`warning: no $/month price for plan "${id}"; recording 0 — docs table changed`,
			);
		plan.priceUsd = price ?? 0;
	}

	const catalog: ZenCatalog = {
		extractedAt: new Date().toISOString(),
		go: {
			source: GO_API,
			windowShare: GO_WINDOW_SHARE,
			models: goModels,
			plans,
		},
		zen: { source: ZEN_API, models: parseModels(zenPayload, "zen") },
	};

	const previous = (await Bun.file(OUT).exists())
		? ((await Bun.file(OUT).json()) as ZenCatalog)
		: null;
	await writeFile(OUT, `${JSON.stringify(catalog, null, "\t")}\n`);
	console.log(
		`wrote core/zen.json: go ${goModels.length} models, plans ${Object.entries(plans)
			.map(([id, plan]) => `${id} $${plan.priceUsd}`)
			.join(", ")}, zen ${catalog.zen.models.length} models`,
	);
	report(previous, catalog);
}
