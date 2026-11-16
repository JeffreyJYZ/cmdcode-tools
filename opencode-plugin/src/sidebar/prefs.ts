// Sidebar preferences. Colour is OFF unless asked for: the panel reads fine
// without it, and a coloured sidebar is a taste call, not a sensible default.
// The OpenCode Go plan defaults to `go`; `go-plus` grants different per-model
// limits, and nothing local records which one the user has, so it is a setting.
// The OpenDesign section is ON, like the other three; only an OpenDesign session
// ever spawns `oduse`, so leaving it on costs nothing elsewhere.
//
//   ~/.config/opencode/command-code.json   { "colors": true, "ocPlan": "go-plus",
//                                            "od": false, "odPlan": "pro" }
//   CMD_COLORS=1 | 0                       one-off override, wins over the file
//   CMD_OC_PLAN=go | go-plus               one-off override, wins over the file
//   CMD_OD=1 | 0                           one-off override, wins over the file
//   CMD_OD_PLAN=go | plus | pro | max      one-off override, wins over the file
//
// Re-read at most once every few seconds (a streaming session must not hit the
// disk per render), so flipping the file lands on the next poll without a
// restart. Nothing here throws: a missing, unreadable or malformed file leaves
// the defaults standing, and an unknown value falls back to its default with a
// warning. The per-key coercion rules live in ./prefs-values, so "what does the
// file accept" is answered in one place.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { OPENCODE_DIR, PREFS_FILE } from "../constants/paths";
import {
	COST_REFRESH_CHOICES,
	COST_REFRESH_DEFAULT_MS,
	type CostMode,
	OC_PLAN_DEFAULT,
	type OcPlan,
	OD_PLAN_DEFAULT,
	type OdPlan,
	POLL_CHOICES,
	POLL_DEFAULT_MS,
	PREF_DEFAULTS,
} from "../constants/sidebar";
import { PREFS_CACHE_MS } from "../constants/timing";
import { boolFrom, costFrom, numberFrom, odPlanFrom, planFrom } from "./prefs-values";

export interface Prefs {
	colors: boolean;
	/** OpenCode Go plan the sidebar renders per-model limits for. */
	ocPlan: OcPlan;
	/** Whether the OpenDesign section is rendered at all (and `oduse` spawned). */
	od: boolean;
	/** OpenDesign plan its caps are read from (nothing local records it). */
	odPlan: OdPlan;
	/** Sidebar poll cadence in ms; one of `POLL_CHOICES`. */
	pollMs: number;
	/**
	 * Where the per-model cost row reads from. `off` scans nothing: the figure
	 * sits inside each message's JSON, so summing it stalls the TUI thread.
	 */
	cost: CostMode;
	/** Opt-in cost re-scan interval in ms; one of `COST_REFRESH_CHOICES`. */
	costMs: number;
}

let cached: { at: number; prefs: Prefs } | undefined;

/** Preferences live beside opencode's own config, XDG layout honoured. */
export function prefsPath(env: NodeJS.ProcessEnv = process.env): string {
	const base = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(base, OPENCODE_DIR, PREFS_FILE);
}

/** One key per setting: colour needs a literal `true`, `od` is on unless a real
 * `false` says otherwise, and the rest fall back to their default. */
export function parsePrefs(raw: unknown): Prefs {
	const obj = raw as
		| {
				colors?: unknown;
				ocPlan?: unknown;
				od?: unknown;
				odPlan?: unknown;
				pollMs?: unknown;
				cost?: unknown;
				costMs?: unknown;
		  }
		| undefined;
	return {
		colors: obj?.colors === true,
		ocPlan: planFrom(obj?.ocPlan, "file") ?? OC_PLAN_DEFAULT,
		od: boolFrom(obj?.od, PREF_DEFAULTS.od, "od"),
		odPlan: odPlanFrom(obj?.odPlan, "file") ?? OD_PLAN_DEFAULT,
		pollMs: numberFrom(obj?.pollMs, POLL_CHOICES, POLL_DEFAULT_MS, "pollMs"),
		cost: costFrom(obj?.cost),
		costMs: numberFrom(obj?.costMs, COST_REFRESH_CHOICES, COST_REFRESH_DEFAULT_MS, "costMs"),
	};
}

/**
 * Write one or more settings back to the prefs file, keeping keys this build
 * does not know yet (the file is shared with the provider half). Atomic:
 * a crash mid-write must not leave an unreadable config behind, because every
 * read below falls back to defaults and would silently reset the user.
 */
export function savePrefs(patch: Partial<Prefs>, env: NodeJS.ProcessEnv = process.env): Prefs {
	const path = prefsPath(env);
	let raw: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			raw = parsed as Record<string, unknown>;
		}
	} catch {
		// absent or malformed: the patch still writes a valid file
	}
	const next = { ...raw, ...patch };
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
	cached = undefined;
	return parsePrefs(next);
}

/** Env override, then the file, then the default. Cached for `PREFS_CACHE_MS`. */
export function loadPrefs(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Prefs {
	if (cached && now - cached.at < PREFS_CACHE_MS) return cached.prefs;
	let prefs = PREF_DEFAULTS;
	// The file is read even when an env override is set, so a per-run colour
	// flag cannot hide the configured plan (and vice versa).
	try {
		prefs = parsePrefs(JSON.parse(readFileSync(prefsPath(env), "utf8")));
	} catch {
		// absent / unreadable / not JSON: the defaults stand
	}
	const flag = env.CMD_COLORS;
	if (flag === "1" || flag === "true") prefs = { ...prefs, colors: true };
	else if (flag === "0" || flag === "false") prefs = { ...prefs, colors: false };
	const envPlan = planFrom(env.CMD_OC_PLAN, "CMD_OC_PLAN");
	if (envPlan !== undefined) prefs = { ...prefs, ocPlan: envPlan };
	const odFlag = env.CMD_OD;
	if (odFlag === "1" || odFlag === "true") prefs = { ...prefs, od: true };
	else if (odFlag === "0" || odFlag === "false") prefs = { ...prefs, od: false };
	const envOdPlan = odPlanFrom(env.CMD_OD_PLAN, "CMD_OD_PLAN");
	if (envOdPlan !== undefined) prefs = { ...prefs, odPlan: envOdPlan };
	cached = { at: now, prefs };
	return prefs;
}
