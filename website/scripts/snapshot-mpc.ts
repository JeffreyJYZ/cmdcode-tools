/**
 * Build-time snapshot of `mpc` for the `/compare` page.
 *
 * Vercel cannot run `mpc` at request time (it needs bun and a live docs scrape),
 * so the comparison is a static snapshot: this script runs `mpc` once per
 * CommandCode × OpenCode Go plan pair and writes `src/data/mpc.json`
 * (committed). Re-run with `bun snapshot:mpc` after a pricing change.
 *
 * `--shape off` is mandatory: mpc's default `--shape auto` shells out to
 * `reqshape`, which itself runs `mpc`, so a bare `mpc --json` recurses
 * (mpc → reqshape → mpc → …). `off` is the cycle break, not an optimisation.
 *
 * A machine often has a stale `mpc` on PATH (an install predating `--oc-plan`)
 * that exits non-zero on the flag, so candidate selection probes by *running*,
 * not merely by resolving: an auto-discovered candidate that fails is logged and
 * skipped, while an explicit `MPC_BIN` that fails stays fatal.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	MpcOcPlanInfo,
	MpcPlanInfo,
	MpcRow,
	MpcRun,
	MpcSide,
	MpcSnapshot,
	MpcTally,
} from "@/lib/mpc";

/** CommandCode plans mpc can price, in the order the page shows them. */
const CC_PLAN_KEYS = ["go", "goat", "pro", "max10", "max20"] as const;

/** OpenCode Go plans mpc can price, in the order the page shows them. */
const OC_PLAN_KEYS = ["go", "go-plus"] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

/**
 * The workspace source, run straight through `bun`. This is the candidate that
 * works in CI, where no `mpc` binary is installed: `bun oc-cmd-compare/src/index.ts`
 * needs only the checkout plus the root `bun install` (for `cac`).
 */
const WORKSPACE_ENTRY = join(REPO_ROOT, "oc-cmd-compare", "src", "index.ts");

/** One way to invoke mpc: an executable plus any args before mpc's own flags. */
export type MpcCandidate = {
	command: string;
	prefixArgs: string[];
	/** Human label for the run log, so each run reports which candidate it used. */
	label: string;
	/** True for `MPC_BIN`: a failure here is fatal, never a silent fall-through. */
	explicit: boolean;
};

/**
 * In order: explicit override, PATH, the two common bun/homebrew spots, then the
 * workspace source with bun — the only form that works in CI.
 */
export function candidates(): MpcCandidate[] {
	const list: MpcCandidate[] = [];
	// MPC_BIN first, so a local `dev:link` / `mpcdev` build still wins.
	if (process.env.MPC_BIN) {
		list.push({
			command: process.env.MPC_BIN,
			prefixArgs: [],
			label: `MPC_BIN=${process.env.MPC_BIN}`,
			explicit: true,
		});
	}
	list.push({
		command: "mpc",
		prefixArgs: [],
		label: "mpc (PATH)",
		explicit: false,
	});
	list.push({
		command: join(homedir(), ".bun", "bin", "mpc"),
		prefixArgs: [],
		label: "~/.bun/bin/mpc",
		explicit: false,
	});
	list.push({
		command: "/opt/homebrew/bin/mpc",
		prefixArgs: [],
		label: "/opt/homebrew/bin/mpc",
		explicit: false,
	});
	list.push({
		command: "bun",
		prefixArgs: [WORKSPACE_ENTRY],
		label: `bun ${WORKSPACE_ENTRY}`,
		explicit: false,
	});
	return list;
}

/**
 * The candidate with a resolved executable (and, for a source run, an existing
 * entry file), or null when it cannot even be located here. Resolution is only
 * the first filter — whether it *runs* is decided by `selectSnapshot`.
 */
export function resolvable(
	candidate: MpcCandidate,
	exists: (path: string) => boolean = existsSync,
	which: (command: string) => string | null = (command) => Bun.which(command),
): MpcCandidate | null {
	const command = candidate.command.includes("/")
		? exists(candidate.command)
			? candidate.command
			: null
		: which(candidate.command);
	if (!command) return null;
	// A source-run candidate also needs its entry file present.
	const entry = candidate.prefixArgs[0];
	if (entry && !exists(entry)) return null;
	return { ...candidate, command };
}

const OUT_FILE = join(SCRIPT_DIR, "..", "src", "data", "mpc.json");

/** The full side mpc's `--json --shape off` emits (see `MpcSide`). */
type RawSide = {
	provider: string;
	plan: string;
	pricing: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number | null;
	};
	allowance: number;
	requestsPerMonth: number | null;
	requestsPerFiveHour: number | null;
	requestsPerWeek: number | null;
	costPerRequest: number;
	payPerRequest: number;
	multiplier: number;
	ability: number | null;
	tps: number | null;
	index: number;
	valueIndex: number | null;
	free?: boolean;
	deal?: { badge: string };
};
type RawRow = {
	key: string;
	name: string;
	oc?: RawSide | null;
	cc?: RawSide | null;
};
export type RawRun = {
	plans: { "oc-go": RawPlan; cc: RawPlan };
	rows: RawRow[];
	tally?: MpcTally;
};
type RawPlan = {
	id: string;
	label: string;
	price: number;
	credits: number;
	fiveHour: number | null;
	weekly: number | null;
};

/** One mpc invocation for a plan pair: returns its parsed `--json` payload. */
export type MpcRunner = (
	mpc: MpcCandidate,
	ccPlanKey: string,
	ocPlanKey: string,
) => RawRun;

/**
 * Persist the whole side mpc reports — every field its own columns read, plus
 * the identifiers — so the page never has to drop a column for want of data.
 * A `null`/absent numeric collapses to `null`, never `undefined` (JSON-safe).
 */
function toSide(raw: RawSide | null | undefined): MpcSide | null {
	if (!raw) return null;
	const side: MpcSide = {
		provider: raw.provider,
		plan: raw.plan,
		pricing: raw.pricing,
		allowance: raw.allowance,
		requestsPerMonth: raw.requestsPerMonth ?? null,
		requestsPerFiveHour: raw.requestsPerFiveHour ?? null,
		requestsPerWeek: raw.requestsPerWeek ?? null,
		costPerRequest: raw.costPerRequest,
		payPerRequest: raw.payPerRequest,
		multiplier: raw.multiplier,
		ability: raw.ability ?? null,
		tps: raw.tps ?? null,
		index: raw.index,
		valueIndex: raw.valueIndex ?? null,
		free: raw.free === true,
	};
	if (raw.deal) side.deal = { badge: raw.deal.badge };
	return side;
}

/** Shell out to one candidate for one plan pair. */
function runMpc(
	mpc: MpcCandidate,
	ccPlanKey: string,
	ocPlanKey: string,
): RawRun {
	const args = [
		...mpc.prefixArgs,
		"--json",
		"--shape",
		"off",
		"--cc-plan",
		ccPlanKey,
		"--oc-plan",
		ocPlanKey,
	];
	const proc = spawnSync(mpc.command, args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (proc.status !== 0) {
		throw new Error(
			`mpc ${args.join(" ")} failed (status ${proc.status}): ` +
				`${proc.stderr || proc.stdout || "(no output)"}`,
		);
	}
	const parsed = JSON.parse(proc.stdout) as RawRun;
	if (!Array.isArray(parsed.rows)) {
		throw new Error(`mpc ${args.join(" ")} returned no rows array`);
	}
	return parsed;
}

/** Run the whole cross product against one candidate and assemble the snapshot. */
export function buildSnapshot(
	mpc: MpcCandidate,
	run: MpcRunner = runMpc,
): MpcSnapshot {
	const byPlan: Record<string, Record<string, MpcRun>> = {};
	const plans: MpcPlanInfo[] = [];
	const ocPlans: MpcOcPlanInfo[] = [];
	const seenOc = new Set<string>();

	for (const ccKey of CC_PLAN_KEYS) {
		const runs: Record<string, MpcRun> = {};
		let cc: RawPlan | null = null;
		for (const ocKey of OC_PLAN_KEYS) {
			const raw = run(mpc, ccKey, ocKey);
			cc = raw.plans.cc;
			const oc = raw.plans["oc-go"];
			const rows: MpcRow[] = raw.rows.map((row) => ({
				key: row.key,
				name: row.name,
				oc: toSide(row.oc),
				cc: toSide(row.cc),
			}));
			runs[ocKey] = { rows, tally: raw.tally };
			if (!seenOc.has(ocKey)) {
				seenOc.add(ocKey);
				ocPlans.push({
					key: ocKey,
					label: oc.label,
					price: oc.price,
					credits: oc.credits,
				});
			}
		}
		byPlan[ccKey] = runs;
		if (!cc) throw new Error(`no CommandCode plan for ${ccKey}`);
		plans.push({
			key: ccKey,
			label: cc.label,
			price: cc.price,
			credits: cc.credits,
			fiveHour: cc.fiveHour ?? null,
			weekly: cc.weekly ?? null,
		});
		console.log(
			`  ${ccKey}: ${Object.keys(runs).length} OpenCode plans (${cc.label})`,
		);
	}

	return {
		generatedAt: new Date().toISOString(),
		plans,
		ocPlans,
		byPlan,
	};
}

/**
 * Pick the first candidate that both resolves and *runs*, assembling the
 * snapshot from it. An auto-discovered candidate that fails to run is logged
 * and skipped (a stale global `mpc` without `--oc-plan` is the usual case); an
 * explicit `MPC_BIN` that cannot be resolved or fails stays fatal.
 */
export function selectSnapshot(
	options: MpcCandidate[],
	resolve: (candidate: MpcCandidate) => MpcCandidate | null = resolvable,
	run: MpcRunner = runMpc,
): { mpc: MpcCandidate; snapshot: MpcSnapshot } {
	const tried: string[] = [];
	for (const option of options) {
		const resolved = resolve(option);
		if (!resolved) {
			const reason = `${option.label} not resolvable`;
			if (option.explicit) throw new Error(`MPC_BIN: ${reason}`);
			tried.push(reason);
			continue;
		}
		try {
			const snapshot = buildSnapshot(resolved, run);
			return { mpc: resolved, snapshot };
		} catch (err) {
			if (option.explicit) throw err;
			const reason = `${resolved.label} failed to run`;
			console.warn(
				`snapshot:mpc — ${reason}, trying next: ${errorMessage(err)}`,
			);
			tried.push(`${reason} (${errorMessage(err)})`);
		}
	}
	throw new Error(
		`no runnable mpc. Tried: ${tried.join(", ") || options.map((c) => c.label).join(", ")}`,
	);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function main(): void {
	const { mpc, snapshot } = selectSnapshot(candidates());
	console.log(`snapshot:mpc — using ${mpc.label}`);
	mkdirSync(dirname(OUT_FILE), { recursive: true });
	writeFileSync(OUT_FILE, `${JSON.stringify(snapshot, null, "\t")}\n`);
	console.log(`snapshot:mpc — wrote ${OUT_FILE}`);
}

if (import.meta.main) main();
