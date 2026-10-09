import {
	SHAPE_AUTO,
	SHAPE_GUARD_ENV,
	SHAPE_MEASURED,
	SHAPE_MIN_REQS,
	SHAPE_OFF,
} from "#~/constants/shape.ts";
import type { Workload } from "#~/types.ts";
import { runBinary } from "./cmduse.ts";

interface Profile {
	input?: number;
	cacheRead?: number;
	output?: number;
	reasoning?: number;
	cacheWrite?: number;
}

interface Payload {
	profile?: Profile;
	/** The full reqshape shape, which carries the sample size. */
	shape?: { perReq?: Profile; reqs?: number };
}

/** reqshape to shell out to; override to test a dev build. */
function reqshapeBin(): string {
	return process.env.REQSHAPE_BIN || "reqshape";
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function round(value: number | undefined): number {
	return Math.round(typeof value === "number" ? value : 0);
}

function count(value: number): string {
	return value.toLocaleString("en-US");
}

/** `1,234 reqs` / `1 req` — the sample size with the right noun. */
function reqWords(value: number): string {
	return `${count(value)} ${value === 1 ? "req" : "reqs"}`;
}

/**
 * The one measured per-req profile, as a Workload. reqshape emits it top-level
 * (`profile` — the vector its own projections were priced against) and as
 * `shape.perReq`; either works, and a payload with neither yields nothing
 * rather than throwing. This is one shape for *both* plans, so the comparison
 * isolates price and allowance from which traffic went where.
 */
export function workloadOf(json: string): Workload | undefined {
	const parsed = JSON.parse(json) as Payload;
	const profile = parsed.profile ?? parsed.shape?.perReq;
	if (!profile) return undefined;
	// Means are fractional; a token count is not, and rounding here keeps the
	// footer and the priced workload showing the same numbers.
	return {
		input: round(profile.input),
		cacheRead: round(profile.cacheRead),
		output: round(profile.output),
		reasoning: round(profile.reasoning),
		cacheWrite: round(profile.cacheWrite),
	};
}

/** Reqs behind the profile, when the payload carries the count. */
export function reqsOf(json: string): number | undefined {
	const reqs = (JSON.parse(json) as Payload).shape?.reqs;
	return typeof reqs === "number" && Number.isFinite(reqs) ? reqs : undefined;
}

function safeWorkload(json: string): Workload | undefined {
	try {
		return workloadOf(json);
	} catch {
		return undefined;
	}
}

/** The shape chosen for the run, plus the footer line that explains it. */
export interface ShapeResolution {
	/** The measured per-req profile to price with; absent means the fixed workload. */
	workload?: Workload;
	/** One footer line: the source, its sample and the alternative. */
	note: string;
}

async function payloadOf(
	source: string,
	args: string[],
	warn: boolean,
): Promise<string | null> {
	if (source !== SHAPE_MEASURED) {
		try {
			return await Bun.file(source).text();
		} catch (error) {
			if (warn) {
				process.stderr.write(
					`mpc: cannot read shape file "${source}": ${message(error)}; using the fixed workload\n`,
				);
			}
			return null;
		}
	}
	const result = await runBinary(reqshapeBin(), args, {
		[SHAPE_GUARD_ENV]: "1",
	});
	if (!result.ok || !result.stdout.trim()) {
		if (warn) {
			process.stderr.write(
				`mpc: reqshape unavailable: ${result.stderr.trim() || "no output"}; using the fixed workload\n`,
			);
		}
		return null;
	}
	return result.stdout;
}

/**
 * Resolve `--shape`. `auto` (the default) asks reqshape and uses its profile
 * only once the sample reaches `SHAPE_MIN_REQS`, so a thin history falls back
 * to the documented fixed workload; `measured` forces reqshape; `off` keeps the
 * fixed workload; anything else is a saved reqshape JSON. Never throws — a
 * missing binary or a bad payload degrades to the fixed workload. The returned
 * `note` names which path was taken, so the footer can show whether reqshape
 * was used and what the alternative flag is.
 */
export async function loadShapes(
	spec: string,
	since?: string,
): Promise<ShapeResolution> {
	const trimmed = spec.trim();
	const args = ["--format", "json"];
	if (since) args.push("--since", since);

	// A nested mpc (reqshape runs `mpc --json`) must not measure again — that is
	// the cycle. Callers that pass `--shape off` never reach here; this catches
	// the ones that do not (a sibling still pinned to the old default).
	if (
		process.env[SHAPE_GUARD_ENV] &&
		(trimmed === SHAPE_AUTO || trimmed === SHAPE_MEASURED)
	) {
		return {
			note: "fixed workload · nested mpc (reqshape is already resolving the shape)",
		};
	}

	if (trimmed === "" || trimmed === SHAPE_OFF) {
		return {
			note: "fixed workload · --shape measured to measure with reqshape",
		};
	}

	if (trimmed === SHAPE_AUTO) {
		const payload = await payloadOf(SHAPE_MEASURED, args, false);
		if (!payload) {
			return {
				note: "fixed workload · reqshape unavailable · --shape measured to require it",
			};
		}
		const reqs = reqsOf(payload);
		const workload = safeWorkload(payload);
		if (!workload || reqs === undefined || reqs < SHAPE_MIN_REQS) {
			const seen = reqs === undefined ? "no req count" : reqWords(reqs);
			return {
				note: `fixed workload · reqshape: ${seen} (< ${count(SHAPE_MIN_REQS)}) · --shape measured to force`,
			};
		}
		return {
			workload,
			note: `reqshape measured · ${reqWords(reqs)} (auto ≥ ${count(SHAPE_MIN_REQS)}) · --shape off to assume the fixed workload`,
		};
	}

	const measured = trimmed === SHAPE_MEASURED;
	const payload = await payloadOf(
		measured ? SHAPE_MEASURED : trimmed,
		args,
		true,
	);
	if (!payload) {
		return {
			note: "fixed workload · shape source unavailable · --shape auto to fall back automatically",
		};
	}
	const workload = safeWorkload(payload);
	if (!workload) {
		if (measured) {
			process.stderr.write(
				"mpc: reqshape reports no measured profile; using the fixed workload\n",
			);
		}
		return { note: "fixed workload · the payload has no measured profile" };
	}
	if (!measured) return { workload, note: `measured from ${trimmed}` };
	const reqs = reqsOf(payload);
	const sample = reqs === undefined ? "" : ` · ${reqWords(reqs)}`;
	return {
		workload,
		note: `reqshape measured (forced)${sample} · --shape off to assume the fixed workload`,
	};
}
