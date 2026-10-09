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
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OPENCODE_DIR, PREFS_FILE } from "../constants/paths";
import {
	OC_PLAN_DEFAULT,
	OC_PLANS,
	type OcPlan,
	PREF_DEFAULTS,
} from "../constants/sidebar";
import { PREFS_CACHE_MS } from "../constants/timing";

export interface Prefs {
	colors: boolean;
	/** OpenCode Go plan the sidebar renders per-model limits for. */
	ocPlan: OcPlan;
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
	if (
		typeof value === "string" &&
		(OC_PLANS as readonly string[]).includes(value)
	) {
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
	const obj = raw as { colors?: unknown; ocPlan?: unknown } | undefined;
	return {
		colors: obj?.colors === true,
		ocPlan: planFrom(obj?.ocPlan, "file") ?? OC_PLAN_DEFAULT,
	};
}

/** Env override, then the file, then the default. Cached for `PREFS_CACHE_MS`. */
export function loadPrefs(
	env: NodeJS.ProcessEnv = process.env,
	now = Date.now(),
): Prefs {
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
	else if (flag === "0" || flag === "false")
		prefs = { ...prefs, colors: false };
	const envPlan = planFrom(env.CMD_OC_PLAN, "CMD_OC_PLAN");
	if (envPlan !== undefined) prefs = { ...prefs, ocPlan: envPlan };
	cached = { at: now, prefs };
	return prefs;
}
