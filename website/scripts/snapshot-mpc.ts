/**
 * Build-time snapshot of `mpc` for the `/compare` page.
 *
 * Vercel cannot run `mpc` at request time (it needs bun and a live docs scrape),
 * so the comparison is a static snapshot: this script runs `mpc` once per
 * CommandCode plan and writes `src/data/mpc.json` (committed). Re-run with
 * `bun snapshot:mpc` after a CommandCode/OpenCode pricing change.
 *
 * `--shape off` is mandatory: mpc's default `--shape auto` shells out to
 * `reqshape`, which itself runs `mpc`, so a bare `mpc --json` recurses
 * (mpc → reqshape → mpc → …). `off` is the cycle break, not an optimisation.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	MpcPlanInfo,
	MpcRow,
	MpcRun,
	MpcSide,
	MpcSnapshot,
	MpcTally,
} from "@/lib/mpc";

/** CommandCode plans mpc can price, in the order the page shows them. */
const CC_PLAN_KEYS = ["go", "goat", "pro", "max10", "max20"] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

/**
 * The workspace source, run straight through `bun`. This is the candidate that
 * works in CI, where no `mpc` binary is installed: `bun oc-cmd-compare/src/index.ts`
 * needs only the checkout plus the root `bun install` (for `cac`).
 */
const WORKSPACE_ENTRY = join(REPO_ROOT, "oc-cmd-compare", "src", "index.ts");

/** One way to invoke mpc: an executable plus any args before mpc's own flags. */
type MpcCandidate = {
	command: string;
	prefixArgs: string[];
	/** Human label for the run log, so each run reports which candidate it used. */
	label: string;
};

/**
 * In order: explicit override, PATH, the two common bun/homebrew spots, then the
 * workspace source with bun — the only form that works in CI.
 */
function candidates(): MpcCandidate[] {
	const list: MpcCandidate[] = [];
	// MPC_BIN first, so a local `dev:link` / `mpcdev` build still wins.
	if (process.env.MPC_BIN) {
		list.push({
			command: process.env.MPC_BIN,
			prefixArgs: [],
			label: `MPC_BIN=${process.env.MPC_BIN}`,
		});
	}
	list.push({ command: "mpc", prefixArgs: [], label: "mpc (PATH)" });
	list.push({
		command: join(homedir(), ".bun", "bin", "mpc"),
		prefixArgs: [],
		label: "~/.bun/bin/mpc",
	});
	list.push({
		command: "/opt/homebrew/bin/mpc",
		prefixArgs: [],
		label: "/opt/homebrew/bin/mpc",
	});
	list.push({
		command: "bun",
		prefixArgs: [WORKSPACE_ENTRY],
		label: `bun ${WORKSPACE_ENTRY}`,
	});
	return list;
}

/** The candidate with a resolved executable, or null if it is not usable here. */
function usable(candidate: MpcCandidate): MpcCandidate | null {
	const command = candidate.command.includes("/")
		? existsSync(candidate.command)
			? candidate.command
			: null
		: Bun.which(candidate.command);
	if (!command) return null;
	// A source-run candidate also needs its entry file present.
	const entry = candidate.prefixArgs[0];
	if (entry && !existsSync(entry)) return null;
	return { ...candidate, command };
}

/** First candidate that resolves on this machine. */
function resolveMpc(): MpcCandidate {
	const options = candidates();
	for (const candidate of options) {
		const resolved = usable(candidate);
		if (resolved) return resolved;
	}
	throw new Error(
		`mpc not found. Looked at: ${options.map((c) => c.label).join(", ")}. ` +
			"Install it (bun link in oc-cmd-compare) or set MPC_BIN.",
	);
}

const OUT_FILE = join(SCRIPT_DIR, "..", "src", "data", "mpc.json");

type RawSide = {
	allowance: number;
	requestsPerMonth: number | null;
	costPerRequest: number;
	ability: number | null;
	free?: boolean;
	deal?: { badge: string };
};
type RawRow = {
	key: string;
	name: string;
	oc?: RawSide | null;
	cc?: RawSide | null;
};
type RawRun = {
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

/** Trim one provider's projection to the fields the table reads. */
function toSide(raw: RawSide | null | undefined): MpcSide | null {
	if (!raw) return null;
	const side: MpcSide = {
		allowance: raw.allowance,
		requestsPerMonth: raw.requestsPerMonth ?? null,
		costPerRequest: raw.costPerRequest,
		ability: raw.ability ?? null,
		free: raw.free === true,
	};
	if (raw.deal) side.deal = { badge: raw.deal.badge };
	return side;
}

function runMpc(mpc: MpcCandidate, planKey: string): RawRun {
	const args = [
		...mpc.prefixArgs,
		"--json",
		"--shape",
		"off",
		"--cc-plan",
		planKey,
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

function main(): void {
	const mpc = resolveMpc();
	console.log(`snapshot:mpc — using ${mpc.label}`);

	const byPlan: Record<string, MpcRun> = {};
	const plans: MpcPlanInfo[] = [];

	for (const key of CC_PLAN_KEYS) {
		const raw = runMpc(mpc, key);
		const cc = raw.plans.cc;
		const rows: MpcRow[] = raw.rows.map((row) => ({
			key: row.key,
			name: row.name,
			oc: toSide(row.oc),
			cc: toSide(row.cc),
		}));
		byPlan[key] = { rows, tally: raw.tally };
		plans.push({
			key,
			label: cc.label,
			price: cc.price,
			credits: cc.credits,
			fiveHour: cc.fiveHour ?? null,
			weekly: cc.weekly ?? null,
		});
		console.log(`  ${key}: ${rows.length} rows (${cc.label})`);
	}

	const snapshot: MpcSnapshot = {
		generatedAt: new Date().toISOString(),
		plans,
		byPlan,
	};

	mkdirSync(dirname(OUT_FILE), { recursive: true });
	writeFileSync(OUT_FILE, `${JSON.stringify(snapshot, null, "\t")}\n`);
	console.log(`snapshot:mpc — wrote ${OUT_FILE}`);
}

main();
