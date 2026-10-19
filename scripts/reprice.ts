#!/usr/bin/env bun
// What the store's turns cost under each of OpenCode Go's price sheets.
//
//   bun scripts/reprice.ts [--days N] [--since ISO] [--db PATH] [--plan go|go-plus]
//                          [--console-pct N] [--cap N] [--json]
//
// `ocuse` reads each turn's recorded `cost` — what opencode wrote. The console
// meters the same turns against the docs' sheets, and DeepSeek's are
// time-of-day split: peak 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday,
// everything else off-peak, at exactly 2x. So "the console says 53%" cannot be
// turned into dollars without knowing which basis is being asked about.
//
// The three totals below make the attribution checkable rather than guessed:
// recorded vs peak-aware vs all-off-peak vs all-peak. Whichever one the
// recorded cost matches is the sheet opencode itself used.
import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

interface Variant {
	peak: "peak" | "off-peak" | null
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}

interface Model {
	id: string
	variants: Variant[]
}

interface Row {
	at: number
	model: string
	input: number
	output: number
	/** Billed at the output rate — opencode's own `cost` on a 520/195/720 row confirms it. */
	reasoning: number
	cacheRead: number
	cacheWrite: number
	cost: number
}

/** Peak windows the docs give for DeepSeek V4.1 Flash / V4 Pro, in UTC hours. */
const PEAK_HOURS: ReadonlyArray<readonly [number, number]> = [
	[1, 4],
	[6, 10],
]

function isPeak(atMs: number): boolean {
	const t = new Date(atMs)
	const day = t.getUTCDay()
	if (day === 0 || day === 6) return false
	const hour = t.getUTCHours()
	return PEAK_HOURS.some(([from, to]) => hour >= from && hour < to)
}

function arg(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name)
	return i === -1 ? undefined : argv[i + 1]
}

function expand(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path
}

const argv = process.argv.slice(2)
const dbPath = expand(arg(argv, "--db") ?? join(homedir(), ".local/share/opencode/opencode.db"))
const days = Number(arg(argv, "--days") ?? 30)
const sinceArg = arg(argv, "--since")
const planId = arg(argv, "--plan") ?? "go"
const consolePct = arg(argv, "--console-pct") ? Number(arg(argv, "--console-pct")) : undefined
const cap = Number(arg(argv, "--cap") ?? 80)
const asJson = argv.includes("--json")

if (!existsSync(dbPath)) {
	console.error(`reprice: no store at ${dbPath}`)
	process.exit(1)
}
const since = sinceArg ? Date.parse(sinceArg) : Date.now() - days * 86_400_000
if (Number.isNaN(since)) {
	console.error("reprice: --since is not a date")
	process.exit(2)
}

const zen = JSON.parse(readFileSync(join(ROOT, "core/zen.json"), "utf8")) as {
	go: { models: Model[] }
}
const byModel = new Map<string, Model>(zen.go.models.map((m) => [m.id, m]))

const db = new Database(dbPath, { readonly: true })
const rows: Row[] = []
for (const raw of db
	.query(
		"SELECT data, time_created FROM session_message WHERE type = 'assistant' AND time_created >= ?",
	)
	.iterate(since) as Iterable<{ data: string; time_created: number }>) {
	let parsed: Record<string, unknown>
	try {
		parsed = JSON.parse(raw.data) as Record<string, unknown>
	} catch {
		continue
	}
	const tokens = parsed.tokens as
		| { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
		| undefined
	if (!tokens) continue // in flight: not billed yet
	const model = parsed.model as { id?: string; providerID?: string } | undefined
	if (model?.providerID !== "opencode-go" && model?.providerID !== "opencode") continue
	rows.push({
		at: raw.time_created,
		model: model.id ?? "",
		input: tokens.input ?? 0,
		output: tokens.output ?? 0,
		reasoning: tokens.reasoning ?? 0,
		cacheRead: tokens.cache?.read ?? 0,
		cacheWrite: tokens.cache?.write ?? 0,
		cost: (parsed.cost as number | undefined) ?? 0,
	})
}
db.close()

type Mode = "peak-aware" | "off-peak" | "peak"

/** The sheet a turn falls under, for one of the three readings. */
function rateFor(model: Model, atMs: number, mode: Mode): Variant | undefined {
	const peak = model.variants.find((v) => v.peak === "peak")
	const offPeak = model.variants.find((v) => v.peak === "off-peak")
	// Models with no time-of-day split (everything but DeepSeek) have a single
	// flat sheet: every reading prices them the same, or the off-peak/peak columns
	// report 0 for spend that is really there.
	const flat = model.variants.find((v) => v.peak === null) ?? model.variants[0]
	if (!peak && !offPeak) return flat
	if (mode === "off-peak") return offPeak ?? peak
	if (mode === "peak") return peak ?? offPeak
	return isPeak(atMs) ? (peak ?? offPeak) : (offPeak ?? peak)
}

function price(row: Row, mode: Mode): number {
	const model = byModel.get(row.model)
	if (!model) return 0
	const rates = rateFor(model, row.at, mode)
	if (!rates) return 0
	return (
		(row.input * rates.input +
			(row.output + row.reasoning) * rates.output +
			row.cacheRead * rates.cacheRead +
			row.cacheWrite * rates.cacheWrite) /
		1e6
	)
}

const MODES: Mode[] = ["peak-aware", "off-peak", "peak"]
const recorded = rows.reduce((sum, row) => sum + row.cost, 0)
const totals = Object.fromEntries(
	MODES.map((mode) => [mode, rows.reduce((sum, row) => sum + price(row, mode), 0)]),
) as Record<Mode, number>

const perModel = new Map<string, { recorded: number; turns: number } & Record<Mode, number>>()
for (const row of rows) {
	const entry =
		perModel.get(row.model) ??
		({ recorded: 0, turns: 0, "peak-aware": 0, "off-peak": 0, peak: 0 } as {
			recorded: number
			turns: number
		} & Record<Mode, number>)
	entry.recorded += row.cost
	entry.turns += 1
	for (const mode of MODES) entry[mode] += price(row, mode)
	perModel.set(row.model, entry)
}
const models = [...perModel.entries()].sort((a, b) => b[1]["peak-aware"] - a[1]["peak-aware"])

if (asJson) {
	console.log(
		JSON.stringify(
			{
				since: new Date(since).toISOString(),
				plan: planId,
				turns: rows.length,
				recorded,
				totals,
				consolePct,
				cap,
				consoleDollars: consolePct === undefined ? null : (consolePct / 100) * cap,
				models: models.map(([id, v]) => ({ id, ...v })),
			},
			null,
			2,
		),
	)
	process.exit(0)
}

console.log(`reprice ${new Date(since).toISOString()} → now · ${rows.length} turns · plan ${planId}`)
console.log(`  recorded (opencode's cost) ${recorded.toFixed(2)}`)
// How much of the traffic actually lands in a peak window: the question behind
// "the console looks like it bills peak regardless", and the difference between
// a peak-aware total that is close to all-peak (everything really is peak) and
// one that is not.
const inPeak = rows.filter((row) => isPeak(row.at))
const peakRecorded = inPeak.reduce((sum, row) => sum + row.cost, 0)
if (rows.length > 0) {
	console.log(
		`  turns in peak windows       ${inPeak.length}/${rows.length} (${((inPeak.length / rows.length) * 100).toFixed(1)}%)`,
	)
}
if (recorded > 0) {
	console.log(
		`  recorded cost in peak       ${peakRecorded.toFixed(2)}/${recorded.toFixed(2)} (${((peakRecorded / recorded) * 100).toFixed(1)}%)`,
	)
}for (const mode of MODES) {
	const ratio = recorded > 0 ? ` (${(totals[mode] / recorded).toFixed(3)}x recorded)` : ""
	console.log(`  ${mode.padEnd(18)} ${totals[mode].toFixed(2).padStart(9)}${ratio}`)
}
if (consolePct !== undefined) {
	const dollars = (consolePct / 100) * cap
	console.log(`  console ${consolePct}% of $${cap}`.padEnd(20) + `${dollars.toFixed(2).padStart(9)}`)
	for (const mode of MODES) {
		if (totals[mode] > 0)
			console.log(`    console / ${mode.padEnd(13)} ${(dollars / totals[mode]).toFixed(3)}x`)
	}
}
console.log("\nmodel                            turns   recorded  peak-aware   off-peak      peak")
for (const [id, v] of models) {
	console.log(
		`${id.padEnd(32)} ${String(v.turns).padStart(5)} ${v.recorded.toFixed(2).padStart(10)} ${v["peak-aware"].toFixed(2).padStart(11)} ${v["off-peak"].toFixed(2).padStart(10)} ${v.peak.toFixed(2).padStart(9)}`,
	)
}
