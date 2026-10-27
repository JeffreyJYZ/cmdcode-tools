#!/usr/bin/env bun
// Reads the console's own price sheet for a model, now, with the UTC clock that
// decides whether "now" is peak.
//
//   bun scripts/go-prices.ts [--model deepseek-v4.1-flash] [--append <file>] [--json]
//
// The question it answers: `GET /console/api/v2/config` publishes one `cost`
// object per provider per model. DeepSeek is documented with peak 01:00-04:00
// and 06:00-10:00 UTC, Mon-Fri at 2x, so if that sheet is time-dependent the
// Go entry must read 0.30/1.20 during those hours and 0.15/0.60 outside them.
// Sampling it on both sides of the boundary settles it; nothing in the mirror's
// console source mentions peak at all, which is suggestive but not proof.
//
// The key comes from `$OCUSE_API_KEY` / `$OPENCODE_API_KEY`, else the newest
// `opencode-go` row of opencode's own `credential` table.
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendFileSync } from "node:fs";

const PEAK_HOURS: ReadonlyArray<readonly [number, number]> = [
	[1, 4],
	[6, 10],
];

function isPeak(atMs: number): boolean {
	const t = new Date(atMs);
	if (t.getUTCDay() === 0 || t.getUTCDay() === 6) return false;
	return PEAK_HOURS.some(([from, to]) => t.getUTCHours() >= from && t.getUTCHours() < to);
}

function arg(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
}

function key(): string {
	const env = process.env.OCUSE_API_KEY ?? process.env.OPENCODE_API_KEY;
	if (env) return env;
	const db = new Database(join(homedir(), ".local/share/opencode/opencode.db"), {
		readonly: true,
	});
	const row = db
		.query(
			"SELECT value FROM credential WHERE integration_id = 'opencode-go' ORDER BY time_updated DESC LIMIT 1",
		)
		.get() as { value?: string } | null;
	db.close();
	if (!row?.value) throw new Error("no Go key: set OCUSE_API_KEY or /connect");
	const parsed = JSON.parse(row.value) as { key?: string; apiKey?: string; value?: string };
	const resolved = parsed.key ?? parsed.apiKey ?? parsed.value;
	if (!resolved) throw new Error("Go credential row carries no key");
	return resolved;
}

const argv = process.argv.slice(2);
const model = arg(argv, "--model") ?? "deepseek-v4.1-flash";
const appendTo = arg(argv, "--append");
const asJson = argv.includes("--json");

const now = Date.now();
const peak = isPeak(now);
const response = await fetch("https://opencode.ai/console/api/v2/config", {
	headers: { Authorization: `Bearer ${key()}` },
});
if (!response.ok) {
	console.error(`config: HTTP ${response.status}`);
	process.exit(1);
}
const config = (await response.json()) as {
	providers: Record<string, { models?: Record<string, { cost?: unknown }> }>;
};

const sample = {
	at: new Date(now).toISOString(),
	peak,
	model,
	providers: Object.fromEntries(
		Object.entries(config.providers).map(([id, provider]) => [
			id,
			provider.models?.[model]?.cost ?? null,
		]),
	),
};

if (appendTo) appendFileSync(appendTo, `${JSON.stringify(sample)}\n`);

if (asJson) {
	console.log(JSON.stringify(sample, null, 2));
} else {
	console.log(`${sample.at} · ${peak ? "PEAK" : "off-peak"} · ${model}`);
	for (const [id, cost] of Object.entries(sample.providers)) {
		const first = Array.isArray(cost) ? cost[0] : cost;
		console.log(`  ${id.padEnd(12)} ${JSON.stringify(first)}`);
	}
	if (!appendTo)
		console.log(
			"\nRun the same command inside 01:00-04:00 or 06:00-10:00 UTC (Mon-Fri):" +
				" a different Go sheet there means the price follows the clock.",
		);
}
