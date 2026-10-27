#!/usr/bin/env bun
/**
 * spend.ts — what opencode's own store recorded as spend.
 *
 * `ocuse` answers this for the Go/Zen providers against their limits and the
 * docs' rates. This is the store's own view, unfiltered: every provider
 * opencode ran, the `cost` it recorded per finished turn, grouped the way you
 * want to read it. That makes it the tool for checking a number against
 * opencode.ai/console — or for seeing what a provider `ocuse` does not cover
 * cost you.
 *
 * Read-only (`readonly: true`), so a running opencode is unaffected. Two
 * layouts, like `cmduse/src/ocuse/db.rs`: v2 `session_message` (role in `type`,
 * model ref nested, in-flight turns carry no tokens and are skipped) and the
 * legacy `message` table.
 *
 * Usage:
 *   bun scripts/spend.ts [options]
 *
 *   --db <path>          store (default $OPENCODE_DB, else ~/.local/share/opencode/opencode.db)
 *   --days <n>           only the last n days
 *   --since <ISO8601>    only turns at or after this instant (wins over --days)
 *   --tz <±HH:MM>        bucket days by this offset (default UTC)
 *   --by <dim>           day | model | provider | session (default day)
 *   --provider <id[,id]> only these provider ids
 *   --model <substr>     only models whose id contains this
 *   --top <n>            limit groups (default 20)
 *   --json               machine-readable
 *   -h, --help
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const DAY_MS = 86_400_000;

interface Turn {
	at: number;
	session: string;
	provider: string;
	model: string;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

interface Options {
	db: string;
	since?: number;
	tz: number;
	by: "day" | "model" | "provider" | "session";
	providers: string[];
	model?: string;
	top: number;
	json: boolean;
}

const HELP = `spend — opencode's own store, what it recorded as spend.

Usage: bun scripts/spend.ts [options]

  --db <path>          store (default $OPENCODE_DB, else ~/.local/share/opencode/opencode.db)
  --days <n>           only the last n days
  --since <ISO8601>    only turns at or after this instant (wins over --days)
  --tz <±HH:MM>        bucket days by this offset (default UTC)
  --by <dim>           day | model | provider | session (default day)
  --provider <id[,id]> only these provider ids
  --model <substr>     only models whose id contains this
  --top <n>            limit groups (default 20)
  --json               machine-readable
  -h, --help
`;

/** `±HH:MM` -> seconds east of UTC (the sign every bucket here uses). */
function parseTz(text: string): number {
	const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text.trim());
	if (!match) throw new Error(`--tz wants ±HH:MM, got "${text}"`);
	const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60;
	return match[1] === "-" ? -seconds : seconds;
}

/** A whole-number flag value, rejected loudly rather than silently becoming NaN. */
function int(flag: string, text: string): number {
	const value = Number(text);
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`${flag} wants a non-negative number, got "${text}"`);
	return value;
}

function defaultDb(): string {
	if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
	const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(base, "opencode", "opencode.db");
}

function parseArgs(argv: string[]): Options {
	const opts: Options = {
		db: defaultDb(),
		tz: 0,
		by: "day",
		providers: [],
		top: 20,
		json: false,
	};
	let days: number | undefined;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		const value = () => {
			const next = argv[i + 1];
			if (next === undefined) throw new Error(`${arg} needs a value`);
			i += 1;
			return next;
		};
		switch (arg) {
			case "-h":
			case "--help":
				process.stdout.write(HELP);
				process.exit(0);
			case "--db":
				opts.db = value();
				break;
			case "--days":
				days = int(arg, value());
				break;
			case "--since": {
				const text = value();
				opts.since = Date.parse(text);
				if (Number.isNaN(opts.since))
					throw new Error(`--since wants an ISO-8601 instant, got "${text}"`);
				break;
			}
			case "--tz":
				opts.tz = parseTz(value());
				break;
			case "--by": {
				const by = value();
				if (by !== "day" && by !== "model" && by !== "provider" && by !== "session")
					throw new Error(`--by wants day|model|provider|session, got "${by}"`);
				opts.by = by;
				break;
			}
			case "--provider":
				opts.providers.push(...value().split(",").filter(Boolean));
				break;
			case "--model":
				opts.model = value();
				break;
			case "--top":
				opts.top = int(arg, value());
				break;
			case "--json":
				opts.json = true;
				break;
			default:
				throw new Error(`unknown option "${arg}" (try --help)`);
		}
	}
	if (days !== undefined) {
		const from = Date.now() - days * DAY_MS;
		opts.since = opts.since === undefined ? from : Math.max(opts.since, from);
	}
	return opts;
}

const num = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

function hasV2(db: Database): boolean {
	const row = db
		.query(
			"SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = 'session_message'",
		)
		.get();
	return row !== null;
}

/** Every finished assistant turn at or after `sinceMs`, oldest first. */
function readTurns(db: Database, sinceMs: number): Turn[] {
	const turns: Turn[] = [];
	if (hasV2(db)) {
		// `id` de-dupes: v2 rewrites a row in place as the turn completes.
		const rows = db
			.query(
				`SELECT id, data, time_created, session_id FROM session_message
				 WHERE type = 'assistant' AND time_created >= ?`,
			)
			.all(sinceMs) as Array<{
			id: string;
			data: string;
			time_created: number;
			session_id: string;
		}>;
		const seen = new Set<string>();
		for (const row of rows) {
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			const data = parse(row.data);
			const model = (data?.model ?? {}) as Record<string, unknown>;
			const tokens = data?.tokens as Record<string, unknown> | undefined;
			if (!tokens) continue; // still streaming: nothing billed yet
			const cache = (tokens.cache ?? {}) as Record<string, unknown>;
			turns.push({
				at: row.time_created,
				session: row.session_id,
				provider: typeof model.providerID === "string" ? model.providerID : "unknown",
				model: typeof model.id === "string" ? model.id : "unknown",
				cost: num(data?.cost),
				input: num(tokens.input),
				output: num(tokens.output),
				cacheRead: num(cache.read),
				cacheWrite: num(cache.write),
			});
		}
		return turns;
	}
	const rows = db
		.query(
			`SELECT data, time_created, session_id FROM message
			 WHERE data LIKE '%"tokens"%' AND time_created >= ?`,
		)
		.all(sinceMs) as Array<{
		data: string;
		time_created: number;
		session_id: string;
	}>;
	for (const row of rows) {
		const data = parse(row.data);
		if (data?.role !== "assistant" || !data.tokens) continue;
		const tokens = data.tokens as Record<string, unknown>;
		const cache = (tokens.cache ?? {}) as Record<string, unknown>;
		turns.push({
			at: row.time_created,
			session: row.session_id,
			provider: typeof data.providerID === "string" ? data.providerID : "unknown",
			model: typeof data.modelID === "string" ? data.modelID : "unknown",
			cost: num(data.cost),
			input: num(tokens.input),
			output: num(tokens.output),
			cacheRead: num(cache.read),
			cacheWrite: num(cache.write),
		});
	}
	return turns;
}

/** One row's JSON payload, or undefined when it is not an object. */
function parse(text: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
		return value as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** `YYYY-MM-DD` in the given offset — never `toISOString`, which is UTC-only. */
function dayOf(atMs: number, tzSecs: number): string {
	const day = Math.floor((atMs + tzSecs * 1000) / DAY_MS);
	return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

interface Group {
	key: string;
	cost: number;
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

function group(turns: Turn[], opts: Options): Group[] {
	const by = new Map<string, Group>();
	for (const turn of turns) {
		const key =
			opts.by === "day"
				? dayOf(turn.at, opts.tz)
				: opts.by === "provider"
					? turn.provider
					: opts.by === "session"
						? turn.session
						: `${turn.provider}/${turn.model}`;
		const entry = by.get(key) ?? {
			key,
			cost: 0,
			requests: 0,
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		};
		entry.cost += turn.cost;
		entry.requests += 1;
		entry.input += turn.input;
		entry.output += turn.output;
		entry.cacheRead += turn.cacheRead;
		entry.cacheWrite += turn.cacheWrite;
		by.set(key, entry);
	}
	const all = [...by.values()];
	if (opts.by === "day") {
		// A timeline, so oldest first — and `--top` keeps the most RECENT days,
		// not the first ones (which read as "the oldest history you have").
		all.sort((a, b) => a.key.localeCompare(b.key));
		return opts.top > 0 ? all.slice(-opts.top) : all;
	}
	all.sort((a, b) => b.cost - a.cost);
	return opts.top > 0 ? all.slice(0, opts.top) : all;
}

const usd = (value: number): string => {
	const rounded = Math.round(value * 100) / 100;
	return `$${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
};

const compact = (value: number): string =>
	value >= 1e6
		? `${(value / 1e6).toFixed(1)}M`
		: value >= 1e3
			? `${(value / 1e3).toFixed(1)}K`
			: `${value}`;

function main(): void {
	const opts = parseArgs(process.argv.slice(2));
	let db: Database;
	try {
		db = new Database(opts.db, { readonly: true });
		// The open is lazy; a read is what proves the file is a usable store.
		hasV2(db);
	} catch (error) {
		process.stderr.write(`spend: cannot read ${opts.db}: ${(error as Error).message}\n`);
		process.exit(1);
	}

	let turns: Turn[];
	try {
		turns = readTurns(db, opts.since ?? 0);
	} finally {
		db.close();
	}
	if (opts.providers.length > 0) {
		turns = turns.filter((turn) => opts.providers.includes(turn.provider));
	}
	if (opts.model) {
		turns = turns.filter((turn) => turn.model.includes(opts.model as string));
	}

	const groups = group(turns, opts);
	const totals = turns.reduce(
		(acc, turn) => ({
			cost: acc.cost + turn.cost,
			requests: acc.requests + 1,
			input: acc.input + turn.input,
			output: acc.output + turn.output,
			cacheRead: acc.cacheRead + turn.cacheRead,
			cacheWrite: acc.cacheWrite + turn.cacheWrite,
		}),
		{ cost: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	);

	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					dbPath: opts.db,
					by: opts.by,
					since: opts.since ?? null,
					totals,
					groups,
				},
				null,
				2,
			)}\n`,
		);
		return;
	}

	const span =
		turns.length === 0
			? "no turns"
			: `${dayOf(Math.min(...turns.map((t) => t.at)), opts.tz)} → ${dayOf(Math.max(...turns.map((t) => t.at)), opts.tz)}`;
	process.stdout.write(`opencode spend — ${opts.db}\n`);
	process.stdout.write(
		`${span} · ${totals.requests} turns · ${usd(totals.cost)} · ${compact(totals.input)} in / ${compact(totals.output)} out · ${compact(totals.cacheRead)} cache read\n`,
	);
	const cut = groups.length === opts.top && opts.top > 0;
	process.stdout.write(
		`\nby ${opts.by}${cut ? (opts.by === "day" ? ` (last ${opts.top} days)` : ` (top ${opts.top})`) : ""}\n`,
	);
	const width = Math.max(6, ...groups.map((entry) => entry.key.length));
	for (const entry of groups) {
		process.stdout.write(
			`${entry.key.padEnd(width)}  ${usd(entry.cost).padStart(9)}  ${String(entry.requests).padStart(6)} turns\n`,
		);
	}
}

main();
