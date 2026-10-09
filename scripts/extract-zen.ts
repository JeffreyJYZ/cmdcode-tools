// Regenerates core/zen.json from OpenCode's own docs.
//
//   bun scripts/extract-zen.ts                 # latest docs
//   bun scripts/extract-zen.ts --go md --zen md   # parse local fixtures
//
// Two products, one file:
//   go  — the Go subscription, which comes in two plans sharing one token price
//         list (**Go** $10/mo and **Go Plus** $40/mo) but granting each model a
//         different monthly dollar limit. Rates live once under `go.models`; the
//         plan dimension lives under `go.plans.<id>.allowanceByModel`, alongside
//         the shared window split (5h = 20%, weekly = 50%, monthly = 100%).
//   zen — pay-as-you-go: $/1M rates only (no limits; you spend a balance)
//
// Model ids come from each page's endpoint table (name -> id), because the
// pricing tables name models in prose ("GLM 5.3 Flash (≤ 200K tokens)").
// Rate variants (peak/off-peak, context tiers) are kept as separate entries
// keyed by variant label, so a caller can pick the right one later.
//
// The two Go plans sit in `<Tabs syncKey="go-plan">` -> `<TabItem label="…">`:
// the pricing tables carry a `Monthly limit` column that differs per plan, while
// Input/Output/Cached columns repeat verbatim. We parse each priced tab, take
// the first for the shared rates, and record every tab's limits under its plan.
import { writeFile } from "node:fs/promises"

// The docs pages are rendered HTML; their source is markdown with pipe tables,
// so scrape the .mdx the pages themselves link ("Edit page"). More stable than
// HTML tables and identical to what readers see.
const GO_URL = "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/go.mdx"
const ZEN_URL = "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/zen.mdx"
const OUT = new URL("../core/zen.json", import.meta.url).pathname

/** The documented window split for Go, as fractions of a model's monthly limit. */
export const GO_WINDOW_SHARE = { fiveHour: 0.2, weekly: 0.5, monthly: 1 } as const

export interface RateVariant {
	/** "peak" | "off-peak" | null — DeepSeek's time-of-day split. */
	peak: "peak" | "off-peak" | null
	/** Context tier ceiling in tokens (e.g. 272000): applies when input ≤ this. */
	tierMaxTokens: number | null
	/** Context tier floor in tokens: applies when input is above it. */
	tierMinTokens: number | null
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}

export interface ZenModel {
	id: string
	name: string
	variants: RateVariant[]
}

/** One Go plan: a price plus a monthly dollar limit per model id. */
export interface GoPlan {
	label: string
	priceUsd: number
	/** model id -> monthly dollar limit; a missing id is free/unlimited. */
	allowanceByModel: Record<string, number>
}

export interface GoCatalogue {
	windowShare: typeof GO_WINDOW_SHARE
	/** Token rates, shared across plans (pricing is the same for both). */
	models: ZenModel[]
	/** Keyed by plan slug ("go", "go-plus"); only the allowances differ. */
	plans: Record<string, GoPlan>
}

export interface ZenCatalog {
	extractedAt: string
	go: GoCatalogue
	zen: { models: ZenModel[] }
}

const MONEY = /^\$?([\d.]+)$/
const FREE = /^free$/i
const DASH = /^[-—]$/

function money(cell: string | undefined): number | undefined {
	const value = (cell ?? "").trim()
	if (FREE.test(value)) return 0
	const match = value.match(MONEY)
	return match ? Number(match[1]) : undefined
}

/** Model names in prose and in the id table differ only in punctuation. */
function normalize(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/** "Go Plus" -> "go-plus"; a stable key for the plan map and the `--plan` flag. */
export function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

/** "GLM 5.3 Flash (≤ 200K tokens)" -> name + tier; "(Peak)" -> peak variant. */
export function tierBounds(cell: string): { tierMaxTokens: number | null; tierMinTokens: number | null } {
	const match = cell.match(/\(\s*(≤|<=|>|>=)\s*([\d.]+)\s*([KM])\s*tokens?\s*\)/i)
	if (!match) return { tierMaxTokens: null, tierMinTokens: null }
	const tokens = Math.round(Number(match[2]) * ((match[3] ?? "K").toUpperCase() === "M" ? 1_000_000 : 1000))
	const ceiling = match[1] === "≤" || match[1] === "<="
	return ceiling ? { tierMaxTokens: tokens, tierMinTokens: null } : { tierMaxTokens: null, tierMinTokens: tokens }
}

export function splitName(cell: string): {
	name: string
	peak: RateVariant["peak"]
	tierMaxTokens: number | null
	tierMinTokens: number | null
} {
	const bounds = tierBounds(cell)
	const peak = /\(peak\)/i.test(cell) ? "peak" : /\(off-?peak\)/i.test(cell) ? "off-peak" : null
	const name = cell
		.replace(/\(\s*(?:≤|<=|>|>=)\s*[\d.]+\s*[KM]\s*tokens?\s*\)/i, "")
		.replace(/\((?:peak|off-?peak)\)/i, "")
		.trim()
	return { name, peak, ...bounds }
}

/** Tables are pipe rows; a header row plus `|---|` separator precede the data. */
function tableRows(markdown: string): string[][] {
	const rows: string[][] = []
	for (const line of markdown.split("\n")) {
		if (!line.trim().startsWith("|")) continue
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((c) => c.replace(/[*`]/g, "").trim())
		if (cells.length === 0 || cells.every((c) => /^-+$/.test(c) || c === "")) continue
		rows.push(cells)
	}
	return rows
}

/** `| Name | model-id | endpoint | sdk |` -> name -> id. */
export function parseEndpoints(markdown: string): Map<string, string> {
	const map = new Map<string, string>()
	for (const cells of tableRows(markdown)) {
		if (cells.length < 2) continue
		const id = cells[1] ?? ""
		// Model ids are bare slugs; skip headers and anything with spaces.
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) continue
		if (!cells[2]?.includes("/zen/")) continue
		const name = (cells[0] ?? "").replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim()
		if (!name) continue
		map.set(name, id)
	}
	return map
}

/** `| Plan | Price | Included usage |` -> { go: 10, "go-plus": 40 }. */
export function parsePlanPrices(markdown: string): Map<string, number> {
	const prices = new Map<string, number>()
	for (const cells of tableRows(markdown)) {
		const label = cells[0] ?? ""
		const match = (cells[1] ?? "").match(/\$([\d.]+)\s*\/\s*month/i)
		if (!label || !match) continue
		prices.set(slugify(label), Number(match[1]))
	}
	return prices
}

/** Every `<TabItem label="…">body</TabItem>`, in document order. */
export function tabItems(markdown: string): Array<{ label: string; body: string }> {
	const out: Array<{ label: string; body: string }> = []
	const re = /<TabItem\s+label="([^"]+)"\s*>([\s\S]*?)<\/TabItem>/g
	for (let match = re.exec(markdown); match; match = re.exec(markdown)) {
		out.push({ label: match[1], body: match[2] })
	}
	return out
}

/** `| Model | Input | Output | Cached Read | Cached Write | [Monthly limit] |` */
export function parseRates(markdown: string, withLimit: boolean): Array<{ name: string; limit?: number; variant: RateVariant }> {
	const out: Array<{ name: string; limit?: number; variant: RateVariant }> = []
	for (const cells of tableRows(markdown)) {
		if (cells.length < 5) continue
		const input = money(cells[1])
		const output = money(cells[2])
		if (input === undefined || output === undefined) continue
		const [cacheReadRaw, cacheWriteRaw] = [cells[3], cells[4]]
		const cacheRead = FREE.test(cacheReadRaw ?? "") ? 0 : (money(cacheReadRaw) ?? 0)
		const cacheWrite = FREE.test(cacheWriteRaw ?? "") || DASH.test(cacheWriteRaw ?? "") ? 0 : (money(cacheWriteRaw) ?? 0)
		const split = splitName(cells[0] ?? "")
		const limit = withLimit ? (FREE.test(cells[5] ?? "") ? undefined : money(cells[5])) : undefined
		out.push({
			name: split.name,
			limit,
			variant: {
				peak: split.peak,
				tierMaxTokens: split.tierMaxTokens,
				tierMinTokens: split.tierMinTokens,
				input,
				output,
				cacheRead,
				cacheWrite,
			},
		})
	}
	return out
}

type EndpointIndex = Map<string, { id: string; name: string }>

/** Normalized-prose-name -> id, so a rate row can be joined to a model id. */
function endpointIndex(endpoints: Map<string, string>): EndpointIndex {
	const index: EndpointIndex = new Map()
	for (const [name, id] of endpoints) index.set(normalize(name), { id, name })
	return index
}

/** Join rates (by prose name) onto ids (from the endpoint table). */
export function assemble(index: EndpointIndex, rates: ReturnType<typeof parseRates>): ZenModel[] {
	const models = new Map<string, ZenModel>()
	const unmatched: string[] = []
	for (const rate of rates) {
		const hit = index.get(normalize(rate.name))
		if (!hit) {
			unmatched.push(rate.name)
			continue
		}
		const model = models.get(hit.id) ?? { id: hit.id, name: rate.name, variants: [] }
		model.variants.push(rate.variant)
		models.set(hit.id, model)
	}
	if (unmatched.length > 0) console.warn(`warning: ${unmatched.length} priced names had no model id: ${unmatched.slice(0, 6).join(", ")}`)
	return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** One plan tab's `Monthly limit` column -> { model id: limit }, free models omitted. */
export function allowances(index: EndpointIndex, rates: ReturnType<typeof parseRates>): Record<string, number> {
	const out: Record<string, number> = {}
	const unmatched: string[] = []
	for (const rate of rates) {
		if (rate.limit === undefined) continue
		const hit = index.get(normalize(rate.name))
		if (!hit) {
			unmatched.push(rate.name)
			continue
		}
		out[hit.id] = rate.limit
	}
	if (unmatched.length > 0) console.warn(`warning: ${unmatched.length} limited names had no model id: ${unmatched.slice(0, 6).join(", ")}`)
	return out
}

async function readSource(url: string, override?: string): Promise<string> {
	if (override) return Bun.file(override).text()
	return (await fetch(url)).text()
}

if (import.meta.main) {
	const args = process.argv.slice(2)
	const value = (flag: string) => {
		const i = args.indexOf(flag)
		return i >= 0 ? args[i + 1] : undefined
	}
	const [goMd, zenMd] = await Promise.all([readSource(GO_URL, value("--go")), readSource(ZEN_URL, value("--zen"))])

	// --- Go: shared rates + a plan map of per-model allowances ----------------
	const goEndpoints = parseEndpoints(goMd)
	const goIndex = endpointIndex(goEndpoints)
	const prices = parsePlanPrices(goMd)

	// Priced tabs only: the doc carries a second `<Tabs syncKey="go-plan">` whose
	// tabs are request-count estimates (no rates), so an empty parse rejects them.
	const planTabs = tabItems(goMd)
		.map((tab) => ({ ...tab, slug: slugify(tab.label), rates: parseRates(tab.body, true) }))
		.filter((tab) => tab.rates.length > 0)
	if (planTabs.length < 2) {
		throw new Error(`go.mdx: expected one priced <TabItem> per plan, found ${planTabs.length} — docs layout changed`)
	}

	const goModels = assemble(goIndex, planTabs[0].rates)
	const knownIds = new Set(goModels.map((model) => model.id))
	const plans: Record<string, GoPlan> = {}
	for (const tab of planTabs) {
		const priceUsd = prices.get(tab.slug)
		if (priceUsd === undefined) throw new Error(`go.mdx: no $/month price for plan "${tab.label}" — docs layout changed`)
		const allowanceByModel = allowances(goIndex, tab.rates)
		if (Object.keys(allowanceByModel).length === 0) {
			throw new Error(`go.mdx: plan "${tab.label}" listed no per-model limits — docs layout changed`)
		}
		plans[tab.slug] = { label: tab.label, priceUsd, allowanceByModel }
		// Rates are shared: every plan must price the same model set.
		const tabIds = new Set(
			tab.rates.map((rate) => goIndex.get(normalize(rate.name))?.id).filter((id): id is string => id !== undefined),
		)
		for (const id of knownIds) {
			if (!tabIds.has(id)) console.warn(`warning: plan "${tab.label}" lists no row for ${id}`)
		}
	}

	// --- Zen: rates only ------------------------------------------------------
	const zenModels = assemble(endpointIndex(parseEndpoints(zenMd)), parseRates(zenMd, false))
	if (goModels.length === 0 || zenModels.length === 0) throw new Error("parsed no models — docs layout changed")

	const catalog: ZenCatalog = {
		extractedAt: new Date().toISOString(),
		go: { windowShare: GO_WINDOW_SHARE, models: goModels, plans },
		zen: { models: zenModels },
	}
	await writeFile(OUT, `${JSON.stringify(catalog, null, "\t")}\n`)
	console.log(
		`wrote core/zen.json: go ${goModels.length} models, plans ${Object.keys(plans).join(", ")}, zen ${zenModels.length} models`,
	)
}
