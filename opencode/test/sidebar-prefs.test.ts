import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrefs, parsePrefs, prefsPath } from "../src/sidebar/prefs";

/** Distinct `now` values sidestep the loader's short re-read cache. */
const tick = (() => {
	let t = 1_000_000;
	return () => (t += 10_000);
})();

const configDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-prefs-"));
	mkdirSync(join(dir, "opencode"), { recursive: true });
	return { dir, env: { XDG_CONFIG_HOME: dir } };
};

describe("sidebar prefs", () => {
	test("colour is off unless the file says otherwise", () => {
		const { dir, env } = configDir();
		expect(prefsPath(env)).toBe(join(dir, "opencode", "command-code.json"));
		// Nothing on disk.
		expect(loadPrefs(env, tick())).toEqual({ colors: false });
	});

	test("the file turns it on, and only a literal true does", () => {
		expect(parsePrefs({ colors: true })).toEqual({ colors: true });
		expect(parsePrefs({ colors: "yes" })).toEqual({ colors: false });
		expect(parsePrefs({ colors: 1 })).toEqual({ colors: false });
		expect(parsePrefs({})).toEqual({ colors: false });
		expect(parsePrefs(undefined)).toEqual({ colors: false });

		const { dir, env } = configDir();
		writeFileSync(join(dir, "command-code.json"), '{"colors": true}');
		// Wrong directory on purpose: the panel must not read a stray file.
		expect(loadPrefs(env, tick())).toEqual({ colors: false });
		writeFileSync(prefsPath(env), '{"colors": true}');
		expect(loadPrefs(env, tick())).toEqual({ colors: true });
	});

	test("malformed json falls back to the default instead of throwing", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), "{not json");
		expect(loadPrefs(env, tick())).toEqual({ colors: false });
	});

	test("CMD_COLORS overrides the file both ways", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"colors": true}');
		expect(loadPrefs({ ...env, CMD_COLORS: "1" }, tick()).colors).toBe(true);
		expect(loadPrefs({ ...env, CMD_COLORS: "0" }, tick()).colors).toBe(false);
		expect(loadPrefs({ ...env, CMD_COLORS: "nope" }, tick()).colors).toBe(true);
	});

	test("repeat reads inside the window do not hit the disk", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"colors": true}');
		const first = loadPrefs(env, tick());
		// Flip the file; a read inside CACHE_MS still returns the cached value.
		writeFileSync(prefsPath(env), '{"colors": false}');
		expect(loadPrefs(env, tick() - 9_000)).toEqual(first);
		// Past the window it is re-read.
		expect(loadPrefs(env, tick()).colors).toBe(false);
	});
});
