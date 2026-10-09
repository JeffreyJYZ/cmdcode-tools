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

/** In order: explicit override, PATH, then the two common bun/homebrew spots. */
const BINARY_CANDIDATES = [
	process.env.MPC_BIN,
	"mpc",
	join(homedir(), ".bun", "bin", "mpc"),
	"/opt/homebrew/bin/mpc",
].filter((c): c is string => Boolean(c));

const OUT_FILE = join(
	fileURLToPath(import.meta.url),
	"..",
	"..",
	"src",
	"data",
	"mpc.json",
);

/** First candidate that resolves to a real executable path. */
function resolveMpc(): string {
	for (const candidate of BINARY_CANDIDATES) {
		if (candidate.includes("/")) {
			if (existsSync(candidate)) return candidate;
		} else {
			const resolved = Bun.which(candidate);
			if (resolved) return resolved;
		}
	}
	throw new Error(
		`mpc not found. Looked at: ${BINARY_CANDIDATES.join(", ")}. ` +
			"Install it (bun link in oc-cmd-compare) or set MPC_BIN.",
	);
}

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

function runMpc(bin: string, planKey: string): RawRun {
	const args = ["--json", "--shape", "off", "--cc-plan", planKey];
	const proc = spawnSync(bin, args, {
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
	const bin = resolveMpc();
	console.log(`snapshot:mpc — using ${bin}`);

	const byPlan: Record<string, MpcRun> = {};
	const plans: MpcPlanInfo[] = [];

	for (const key of CC_PLAN_KEYS) {
		const raw = runMpc(bin, key);
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
