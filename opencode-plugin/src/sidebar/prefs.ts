// Sidebar preferences. Colour is OFF unless asked for: the panel reads fine
// without it, and a coloured sidebar is a taste call, not a sensible default.
// The OpenCode Go plan defaults to `go`; `go-plus` grants different per-model
// limits, and nothing local records which one the user has, so it is a setting.
//
//   ~/.config/opencode/command-code.json   { "colors": true, "ocPlan": "go-plus" }
//   CMD_COLORS=1 | 0                       one-off override, wins over the file
//   CMD_OC_PLAN=go | go-plus               one-off override, wins over the file
//
// Re-read at most once every few seconds (a streaming session must not hit the
// disk per render), so flipping the file lands on the next poll without a
// restart. Nothing here throws: a missing, unreadable or malformed file leaves
// the defaults standing, and an unknown plan falls back to `go` with a warning.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { OPENCODE_DIR, PREFS_FILE } from "../constants/paths";
import {
	COST_MODE_DEFAULT,
	COST_MODES,
	COST_REFRESH_CHOICES,
	COST_REFRESH_DEFAULT_MS,
	type CostMode,
	OC_PLAN_DEFAULT,
	OC_PLANS,
	type OcPlan,
	POLL_CHOICES,
	POLL_DEFAULT_MS,
	PREF_DEFAULTS,
} from "../constants/sidebar";
import { PREFS_CACHE_MS } from "../constants/timing";

export interface Prefs {
	colors: boolean;
	/** OpenCode Go plan the sidebar renders per-model limits for. */
	ocPlan: OcPlan;
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

/** A plan id is only accepted verbatim; anything else asks for the default. */
function planFrom(value: unknown, source: string): OcPlan | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (OC_PLANS as readonly string[]).includes(value)) {
		return value as OcPlan;
	}
	// Never crash or blank the panel over a typo: warn and use the default.
	console.warn(
		`[command-code] ignoring unknown OpenCode plan ${JSON.stringify(value)} (${source}); using "${OC_PLAN_DEFAULT}"`,
	);
	return undefined;
}

/** Only a literal `true` enables colour; an unknown plan falls back to `go`. */
export function parsePrefs(raw: unknown): Prefs {
	const obj = raw as
		| { colors?: unknown; ocPlan?: unknown; pollMs?: unknown; cost?: unknown; costMs?: unknown }
		| undefined;
	return {
		colors: obj?.colors === true,
		ocPlan: planFrom(obj?.ocPlan, "file") ?? OC_PLAN_DEFAULT,
		pollMs: numberFrom(obj?.pollMs, POLL_CHOICES, POLL_DEFAULT_MS, "pollMs"),
		cost: costFrom(obj?.cost),
		costMs: numberFrom(obj?.costMs, COST_REFRESH_CHOICES, COST_REFRESH_DEFAULT_MS, "costMs"),
	};
}

/**
 * A numeric setting only ever takes a value the settings dialog can produce,
 * so a hand-edited file cannot pick a 1ms poll or a 0ms re-scan.
 */
function numberFrom(
	value: unknown,
	choices: readonly number[],
	fallback: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	if (typeof value === "number" && choices.includes(value)) return value;
	console.warn(
		`[command-code] ignoring unknown ${name} ${JSON.stringify(value)}; using ${fallback}`,
	);
	return fallback;
}

function costFrom(value: unknown): CostMode {
	if (value === undefined) return COST_MODE_DEFAULT;
	if (typeof value === "string" && (COST_MODES as readonly string[]).includes(value)) {
		return value as CostMode;
	}
	console.warn(
		`[command-code] ignoring unknown cost mode ${JSON.stringify(value)}; using "${COST_MODE_DEFAULT}"`,
	);
	return COST_MODE_DEFAULT;
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
	cached = { at: now, prefs };
	return prefs;
}
