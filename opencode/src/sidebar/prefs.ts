// Sidebar preferences. Colour is OFF unless asked for: the panel reads fine
// without it, and a coloured sidebar is a taste call, not a sensible default.
//
//   ~/.config/opencode/command-code.json   { "colors": true }
//   CMD_COLORS=1 | 0                       one-off override, wins over the file
//
// Re-read at most once every few seconds (a streaming session must not hit the
// disk per render), so flipping the file lands on the next poll without a
// restart. Nothing here throws: a missing, unreadable or malformed file leaves
// the default standing.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OPENCODE_DIR, PREFS_FILE } from "../constants/paths";
import { PREF_DEFAULTS } from "../constants/sidebar";
import { PREFS_CACHE_MS } from "../constants/timing";

export interface Prefs {
	colors: boolean;
}

let cached: { at: number; prefs: Prefs } | undefined;

/** Preferences live beside opencode's own config, XDG layout honoured. */
export function prefsPath(env: NodeJS.ProcessEnv = process.env): string {
	const base = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(base, OPENCODE_DIR, PREFS_FILE);
}

/** Only a literal `true` enables colour, so a typo cannot turn the panel on. */
export function parsePrefs(raw: unknown): Prefs {
	const value = (raw as { colors?: unknown } | undefined)?.colors;
	return { colors: value === true };
}

/** Env override, then the file, then the default. Cached for `PREFS_CACHE_MS`. */
export function loadPrefs(
	env: NodeJS.ProcessEnv = process.env,
	now = Date.now(),
): Prefs {
	if (cached && now - cached.at < PREFS_CACHE_MS) return cached.prefs;
	const flag = env.CMD_COLORS;
	let prefs = PREF_DEFAULTS;
	if (flag === "1" || flag === "true") prefs = { colors: true };
	else if (flag === "0" || flag === "false") prefs = { colors: false };
	else {
		try {
			prefs = parsePrefs(
				JSON.parse(readFileSync(prefsPath(env), "utf8")),
			);
		} catch {
			// absent / unreadable / not JSON: the default stands
		}
	}
	cached = { at: now, prefs };
	return prefs;
}
