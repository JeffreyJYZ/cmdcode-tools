// Regenerates core/zen.json from OpenCode's own docs.
//
//   bun scripts/extract-zen.ts                 # latest docs
//   bun scripts/extract-zen.ts --go md --zen md   # parse local fixtures
//
// Two products, one file:
//   go  — the $10/mo subscription: per-model monthly dollar limits, with the
//         documented window split (5h = 20%, weekly = 50%, monthly = 100%) and
//         the $/1M rates it lists beside each limit
//   zen — pay-as-you-go: $/1M rates only (no limits; you spend a balance)
//
// Model ids come from each page's endpoint table (name -> id), because the
// pricing tables name models in prose ("GLM 5.3 Flash (≤ 200K tokens)").
// Rate variants (peak/off-peak, context tiers) are kept as separate entries
// keyed by variant label, so a caller can pick the right one later.
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
	/** Go only: the monthly dollar limit for this model. */
	monthlyLimit?: number
	variants: RateVariant[]
}

export interface ZenCatalog {
	extractedAt: string
	go: { priceUsd: number; windowShare: typeof GO_WINDOW_SHARE; models: ZenModel[] }
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

/** Join rates (by prose name) onto ids (from the endpoint table). */
export function assemble(endpoints: Map<string, string>, rates: ReturnType<typeof parseRates>): ZenModel[] {
	const byNormalized = new Map<string, { id: string; name: string }>()
	for (const [name, id] of endpoints) {
		byNormalized.set(name.toLowerCase().replace(/[^a-z0-9]+/g, ""), { id, name })
	}
	const models = new Map<string, ZenModel>()
	const unmatched: string[] = []
	for (const rate of rates) {
		const key = rate.name.toLowerCase().replace(/[^a-z0-9]+/g, "")
		const hit = byNormalized.get(key)
		if (!hit) {
			unmatched.push(rate.name)
			continue
		}
		const model = models.get(hit.id) ?? { id: hit.id, name: rate.name, variants: [] }
		if (rate.limit !== undefined) model.monthlyLimit = rate.limit
		model.variants.push(rate.variant)
		models.set(hit.id, model)
	}
	if (unmatched.length > 0) console.warn(`warning: ${unmatched.length} priced names had no model id: ${unmatched.slice(0, 6).join(", ")}`)
	return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
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
	const goModels = assemble(parseEndpoints(goMd), parseRates(goMd, true))
	const zenModels = assemble(parseEndpoints(zenMd), parseRates(zenMd, false))
	if (goModels.length === 0 || zenModels.length === 0) throw new Error("parsed no models — docs layout changed")
	const catalog: ZenCatalog = {
		extractedAt: new Date().toISOString(),
		go: { priceUsd: 10, windowShare: GO_WINDOW_SHARE, models: goModels },
		zen: { models: zenModels },
	}
	await writeFile(OUT, `${JSON.stringify(catalog, null, "\t")}\n`)
	console.log(`wrote core/zen.json: go ${goModels.length} models, zen ${zenModels.length} models`)
}
