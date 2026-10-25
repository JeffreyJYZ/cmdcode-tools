// Data half of the sidebar: fetch the usage snapshot from cmduse and the
// per-model catalog (allowance, rates, Intelligence, Tok/s) from mpc.
//
// Both are read-only spawns. Usage is polled (cheap, local); the mpc catalog
// is cached on disk because it reads live docs over the network.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type RunOptions, runArkuse, runCmduse, runMpc, runOcuse } from "../cli";
import { SPAWN_OPTIONS } from "../constants/cli";
import { CACHE_DIR, ccCatalogFile } from "../constants/paths";
import { OC_PLAN_DEFAULT, type OcPlan } from "../constants/sidebar";
import { ARK_SNAPSHOT_TTL_MS, CATALOG_CACHE_TTL_MS, CHILD_TIMEOUT_MS } from "../constants/timing";
import { type ArkUsage, parseArkJson } from "./ark";
import { type ModelMeta, modelKey, type Usage } from "./rows";
import { parseZenJson, type ZenUsage } from "./zen";

// The sidebar spawns the same CLIs as the /cmd-usage dialog, through the same
// helpers in ../cli (one candidate loop, one install hint). It differs in two
// ways the tool path does not need: `detached` gives the child no controlling
// terminal, so cmduse's /dev/tty spinner cannot overpaint the TUI; and the
// timeout bounds one spawn, since an outage can park it in cmduse's retry
// ladder and the poll would otherwise stack spawns. `CMDUSE_BIN`/`MPC_BIN`/
// `OCUSE_BIN` all reach the sidebar through those helpers.
const SIDEBAR_OPTS: RunOptions = {
	spawnOptions: SPAWN_OPTIONS,
	timeoutMs: CHILD_TIMEOUT_MS,
};

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
		monthlyCap: typeof raw.monthlyCap === "number" ? raw.monthlyCap : undefined,
		monthlyCredits: typeof raw.monthlyCredits === "number" ? raw.monthlyCredits : undefined,
		fiveHour: win(raw.fiveHour),
		weekly: win(raw.weekly),
		periodEnd: typeof raw.periodEnd === "string" ? raw.periodEnd : undefined,
		// cmduse 0.7.2+ also publishes the period bounds in epoch ms; older
		// builds omit them and the monthly row then shows spend only.
		periodStartAt: typeof raw.periodStartAt === "number" ? raw.periodStartAt : undefined,
		periodEndAt: typeof raw.periodEndAt === "number" ? raw.periodEndAt : undefined,
		requests: typeof summary.requests === "number" ? summary.requests : undefined,
		cost: typeof summary.cost === "number" ? summary.cost : undefined,
		error: typeof raw.error === "string" && raw.error ? raw.error : undefined,
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
		/** CommandCode side is unconstrained (no monthly budget to divide). */
		free?: boolean;
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
		/** OpenCode Go side is free/unbounded: its allowance is 0 by convention. */
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
			// `free` is the only signal that a zero allowance means unbounded
			// rather than "$0/mo"; without it the panel prints a bogus budget.
			free: cc?.free === true ? true : undefined,
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
						free: oc.free === true ? true : undefined,
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

function cachePath(plan: OcPlan): string {
	const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(base, CACHE_DIR, ccCatalogFile(plan));
}

/**
 * mpc's args for the per-model catalog. `--shape off` is the recursion break
 * (mpc's default `--shape auto` spawns reqshape, which spawns mpc back), never
 * dropped; `--oc-plan` selects which Go plan's per-model allowance is baked in.
 */
export function metaArgs(plan: OcPlan): string[] {
	return ["--json", "--shape", "off", "--oc-plan", plan];
}

/** ocuse's args: `--plan` selects the Go plan's per-model limits. */
export function zenArgs(plan: OcPlan): string[] {
	return ["-1", "--json", "--plan", plan];
}

/** mpc's catalog, cached on disk: it scrapes live docs over the network. The
 * cache is per plan, since mpc bakes that plan's per-model allowance into it. */
export async function loadMeta(plan: OcPlan = OC_PLAN_DEFAULT): Promise<Map<string, ModelMeta>> {
	try {
		const cached = JSON.parse(await readFile(cachePath(plan), "utf8")) as {
			fetchedAt?: number;
			rows?: [string, ModelMeta][];
		};
		if (cached.fetchedAt && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
			return new Map(cached.rows ?? []);
		}
	} catch {
		// no cache yet
	}
	const meta = parseMpcJson(await runMpc(metaArgs(plan), SIDEBAR_OPTS));
	try {
		const path = cachePath(plan);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify({ fetchedAt: Date.now(), rows: [...meta] }));
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
		parseUsageJson(await runCmduse(["-1", "--json", "--plain"], SIDEBAR_OPTS)),
	);
}

/**
 * One OpenCode Go / Zen snapshot from ocuse: opencode's own store for the
 * per-model totals, plus OpenCode Go's usage endpoint for the account meters
 * when the account has a Go key. Throws when ocuse is missing or fails, and the
 * caller then omits the panel.
 */
export async function loadZen(plan: OcPlan = OC_PLAN_DEFAULT): Promise<ZenUsage> {
	return parseZenJson(await runOcuse(zenArgs(plan), SIDEBAR_OPTS));
}

/** Process-lifetime cache for the ARK snapshot — see `ARK_SNAPSHOT_TTL_MS`:
 *  every `arkuse` run asks the control plane, so the 5s poll must not spawn one
 *  per tick. */
let arkCache: { at: number; usage: ArkUsage } | undefined;

/**
 * One Volcengine ARK snapshot from `arkuse -1 --json`: the plan's own meters
 * (through `arkcli`) plus this store's AFP per model. Cached for a minute
 * because the spawn costs a control-plane round-trip; throws when `arkuse` is
 * missing or fails, and the caller then keeps the last snapshot.
 */
export async function loadArk(): Promise<ArkUsage> {
	const now = Date.now();
	if (arkCache && now - arkCache.at < ARK_SNAPSHOT_TTL_MS) {
		return arkCache.usage;
	}
	const usage = parseArkJson(await runArkuse("-1 --json", SIDEBAR_OPTS));
	arkCache = { at: now, usage };
	return usage;
}
