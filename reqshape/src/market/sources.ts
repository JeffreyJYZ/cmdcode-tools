import { spawnSync } from "node:child_process";
import type { MpcJson } from "./rates.ts";

export interface AccountSummary {
	plan: string;
	requests: number;
	periodEnd: string;
}

export function numberOr(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Run a sibling CLI and parse its JSON, with the failure mode worth reading. */
function runJson<T>(bin: string, args: string[]): T {
	const result = spawnSync(bin, args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	const detail =
		(result.stderr || "").trim() ||
		result.error?.message ||
		"no output (is it installed and on PATH?)";
	if (result.error || result.status !== 0 || !result.stdout) {
		throw new Error(
			`${bin} ${args.join(" ")} failed: ${detail.slice(0, 240)}`,
		);
	}
	return JSON.parse(result.stdout) as T;
}

/** mpc knows both plans' pricing, allowances and window rules. */
export function loadMpc(bin: string): MpcJson {
	// `--shape off`: reqshape only needs mpc's pricing and allowances, and it
	// has no workload of its own to price here. mpc's default `--shape auto`
	// shells out to reqshape, so without the flag this call would recurse
	// (mpc -> reqshape -> mpc -> ...).
	return runJson<MpcJson>(bin, ["--json", "--shape", "off"]);
}

/**
 * The account's own count of requests this period. Optional context, never
 * fatal: an unauthenticated or offline cmduse just means no line is printed.
 */
export function loadAccount(bin: string): AccountSummary | null {
	try {
		const json = runJson<{
			plan?: string;
			periodEnd?: string;
			summary?: { requests?: number };
		}>(bin, ["-1", "--json"]);
		const requests = numberOr(json.summary?.requests);
		if (requests === null) return null;
		return {
			plan: json.plan ?? "",
			requests,
			periodEnd: json.periodEnd ?? "",
		};
	} catch {
		return null;
	}
}
