// Data half of the sidebar: fetch the usage snapshot from cmduse and the
// per-model catalog (allowance, rates, Intelligence, Tok/s) from mpc.
//
// Both are read-only spawns. Usage is polled (cheap, local); the mpc catalog
// is cached on disk because it reads live docs over the network.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cmduseCandidates } from "../cli";
import {
	MPC_BIN_CANDIDATES,
	OCUSE_BIN_CANDIDATES,
} from "../constants/binaries";
import { SPAWN_OPTIONS } from "../constants/cli";
import { CACHE_DIR, CC_CATALOG_FILE } from "../constants/paths";
import { CATALOG_CACHE_TTL_MS, CHILD_TIMEOUT_MS } from "../constants/timing";
import { type ModelMeta, modelKey, type Usage } from "./rows";
import { parseZenJson, type ZenUsage } from "./zen";

// One list, shared with the /cmd-usage dialog: `cli.ts` owns which cmduse we
// run, so CMDUSE_BIN reaches the sidebar too (the brew Cellar is read-only, so
// there is no other way to point the panel at a dev build).
const CMDUSE = cmduseCandidates();
const MPC = MPC_BIN_CANDIDATES;
// ocuse ships in the same crate as cmduse (cmd-usage), so the same override
// applies to it: a dev build can be pointed at without touching the Cellar.
const OCUSE = [process.env.OCUSE_BIN, ...OCUSE_BIN_CANDIDATES].filter(
	(bin): bin is string => Boolean(bin),
);

function run(bin: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, SPAWN_OPTIONS);
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			reject(
				new Error(
					`${bin} ${args.join(" ")}: timed out after ${CHILD_TIMEOUT_MS}ms`,
				),
			);
		}, CHILD_TIMEOUT_MS);
		const done = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		child.stdout?.on("data", (d: Buffer) => out.push(d));
		child.stderr?.on("data", (d: Buffer) => err.push(d));
		child.on("error", (e) => done(() => reject(e)));
		child.on("close", (code) =>
			done(() =>
				code === 0
					? resolve(Buffer.concat(out).toString("utf8"))
					: reject(
							new Error(
								`${bin} ${args.join(" ")}: exit ${code} ${Buffer.concat(err).toString("utf8").slice(-200)}`,
							),
						),
			),
		);
	});
}

async function runFirst(
	candidates: readonly string[],
	args: string[],
): Promise<string> {
	let last: unknown;
	for (const bin of candidates) {
		try {
			return await run(bin, args);
		} catch (e) {
			last = e;
			if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
		}
	}
	throw last instanceof Error
		? last
		: new Error(`${candidates[0]} not found`);
}

/** Parse `cmduse -1 --json` into the usage snapshot. */
export function parseUsageJson(text: string): Usage {
	const raw = JSON.parse(text) as Record<string, unknown>;
	const win = (v: unknown): Usage["fiveHour"] => {
		if (!v || typeof v !== "object") return undefined;
		const w = v as Record<string, unknown>;
		return {
			cap: typeof w.cap === "number" ? w.cap : undefined,
			used: typeof w.used === "number" ? w.used : undefined,
			resetAt: typeof w.resetAt === "number" ? w.resetAt : undefined,
			exceeded: typeof w.exceeded === "boolean" ? w.exceeded : undefined,
		};
	};
	const summary = (raw.summary ?? {}) as Record<string, unknown>;
	return {
		plan: typeof raw.plan === "string" ? raw.plan : undefined,
		monthlyCap:
			typeof raw.monthlyCap === "number" ? raw.monthlyCap : undefined,
		monthlyCredits:
			typeof raw.monthlyCredits === "number"
				? raw.monthlyCredits
				: undefined,
		fiveHour: win(raw.fiveHour),
		weekly: win(raw.weekly),
		periodEnd:
			typeof raw.periodEnd === "string" ? raw.periodEnd : undefined,
		// cmduse 0.7.2+ also publishes the period bounds in epoch ms; older
		// builds omit them and the monthly row then shows spend only.
		periodStartAt:
			typeof raw.periodStartAt === "number"
				? raw.periodStartAt
				: undefined,
		periodEndAt:
			typeof raw.periodEndAt === "number" ? raw.periodEndAt : undefined,
		requests:
			typeof summary.requests === "number" ? summary.requests : undefined,
		cost: typeof summary.cost === "number" ? summary.cost : undefined,
		error:
			typeof raw.error === "string" && raw.error ? raw.error : undefined,
	};
}

/**
 * A snapshot is only usable when cmduse actually reached the account API.
 * `-1 --json` exits 0 on failure and then carries the defaults (plan "Free", no
 * windows) beside an `error`; painting that over a good snapshot is what made
 * the Monthly row flash during an outage. Throw so the caller keeps the last
 * snapshot, exactly as it does when the CLI is missing.
 */
export function requireSnapshot(usage: Usage): Usage {
	if (usage.error) throw new Error(usage.error);
	return usage;
}

interface MpcRow {
	key?: string;
	name?: string;
	cc?: {
		allowance?: number;
		pricing?: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite?: number | null;
		};
		ability?: number | null;
		tps?: number | null;
		/** CommandCode promotion on the row: badge text plus its expiry line. */
		deal?: { badge?: string; ends?: string };
	};
	oc?: {
		provider?: string;
		plan?: string;
		allowance?: number;
		pricing?: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite?: number | null;
		};
		ability?: number | null;
		tps?: number | null;
		free?: boolean;
	};
}

/**
 * Parse `mpc --json` into per-model meta: the CommandCode fields at the top
 * level and the OpenCode Go / Zen side under `oc`, so one lookup serves either
 * kind of session. Rows that carry only one side are kept.
 */
export function parseMpcJson(text: string): Map<string, ModelMeta> {
	const body = JSON.parse(text) as { rows?: MpcRow[] };
	const meta = new Map<string, ModelMeta>();
	for (const row of body.rows ?? []) {
		if (!row.name || (!row.cc && !row.oc)) continue;
		const cc = row.cc;
		const oc = row.oc;
		const entry: ModelMeta = {
			key: row.key ?? modelKey(row.name),
			name: row.name,
			allowance: cc?.allowance,
			rates: cc?.pricing,
			intelligence: cc?.ability ?? undefined,
			tps: cc?.tps ?? undefined,
			deal:
				cc?.deal?.badge !== undefined
					? { badge: cc.deal.badge, ends: cc.deal.ends }
					: undefined,
			oc: oc
				? {
						provider: oc.provider,
						plan: oc.plan,
						allowance: oc.allowance,
						rates: oc.pricing,
						ability: oc.ability ?? undefined,
						tps: oc.tps ?? undefined,
					}
				: undefined,
		};
		// Index by both mpc's key and our own, so lookup does not depend on the
		// two normalizers agreeing on aliases.
		meta.set(entry.key, entry);
		meta.set(modelKey(row.name), entry);
	}
	return meta;
}

function cachePath(): string {
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, CACHE_DIR, CC_CATALOG_FILE);
}

/** mpc's catalog, cached on disk: it scrapes live docs over the network. */
export async function loadMeta(): Promise<Map<string, ModelMeta>> {
	try {
		const cached = JSON.parse(await readFile(cachePath(), "utf8")) as {
			fetchedAt?: number;
			rows?: [string, ModelMeta][];
		};
		if (
			cached.fetchedAt &&
			Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS
		) {
			return new Map(cached.rows ?? []);
		}
	} catch {
		// no cache yet
	}
	const meta = parseMpcJson(await runFirst(MPC, ["--json"]));
	try {
		const path = cachePath();
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify({ fetchedAt: Date.now(), rows: [...meta] }),
		);
	} catch {
		// cache is best-effort
	}
	return meta;
}

/** One usage snapshot from cmduse. Throws when cmduse is missing, fails, or
 * returns the errored defaults its JSON carries when the account API is
 * unreachable (see `requireSnapshot`). */
export async function loadUsage(): Promise<Usage> {
	return requireSnapshot(
		parseUsageJson(await runFirst(CMDUSE, ["-1", "--json", "--plain"])),
	);
}

/**
 * One OpenCode Go / Zen snapshot from ocuse, which reads opencode's own store
 * (those providers have no usage API). Throws when ocuse is missing or fails,
 * and the caller then omits the panel.
 */
export async function loadZen(): Promise<ZenUsage> {
	return parseZenJson(await runFirst(OCUSE, ["-1", "--json"]));
}
