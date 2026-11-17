import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_DIR, PREFS_FILE } from "../src/constants/paths";
import {
	COST_MODE_DEFAULT,
	COST_MODES,
	COST_REFRESH_DEFAULT_MS,
	OC_PLAN_DEFAULT,
	OD_PLAN_DEFAULT,
	OD_PLANS,
	POLL_DEFAULT_MS,
} from "../src/constants/sidebar";
import { loadPrefs, type Prefs, parsePrefs, prefsPath, savePrefs } from "../src/sidebar/prefs";

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

const DEFAULTS: Prefs = {
	colors: false,
	ocPlan: "go",
	od: true,
	odPlan: "go",
	pollMs: 5_000,
	cost: "off",
	costMs: 60_000,
};

describe("sidebar prefs", () => {
	test("colour off and plan `go` unless the file says otherwise", () => {
		const { dir, env } = configDir();
		expect(prefsPath(env)).toBe(join(dir, OPENCODE_DIR, PREFS_FILE));
		// Nothing on disk.
		expect(loadPrefs(env, tick())).toEqual(DEFAULTS);
	});

	test("the file turns colour on, and only a literal true does", () => {
		expect(parsePrefs({ colors: true }).colors).toBe(true);
		expect(parsePrefs({ colors: "yes" }).colors).toBe(false);
		expect(parsePrefs({ colors: 1 }).colors).toBe(false);
		expect(parsePrefs({}).colors).toBe(false);
		expect(parsePrefs(undefined).colors).toBe(false);

		const { dir, env } = configDir();
		writeFileSync(join(dir, "command-code.json"), '{"colors": true}');
		// Wrong directory on purpose: the panel must not read a stray file.
		expect(loadPrefs(env, tick()).colors).toBe(false);
		writeFileSync(prefsPath(env), '{"colors": true}');
		expect(loadPrefs(env, tick()).colors).toBe(true);
	});

	test("the file selects the OpenCode Go plan", () => {
		expect(parsePrefs({ ocPlan: "go-plus" }).ocPlan).toBe("go-plus");
		expect(parsePrefs({ ocPlan: "go" }).ocPlan).toBe("go");
		expect(parsePrefs({}).ocPlan).toBe("go");
		expect(parsePrefs(undefined).ocPlan).toBe("go");

		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"ocPlan": "go-plus"}');
		expect(loadPrefs(env, tick()).ocPlan).toBe("go-plus");
	});

	test("an unknown plan falls back to `go`, never throwing", () => {
		// The warn is expected; silence it so the test output stays clean.
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(parsePrefs({ ocPlan: "go-plus-ultra" }).ocPlan).toBe(OC_PLAN_DEFAULT);
			expect(parsePrefs({ ocPlan: 42 }).ocPlan).toBe(OC_PLAN_DEFAULT);
		} finally {
			console.warn = warn;
		}

		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"ocPlan": "nope"}');
		console.warn = () => {};
		try {
			expect(loadPrefs(env, tick()).ocPlan).toBe(OC_PLAN_DEFAULT);
		} finally {
			console.warn = warn;
		}
	});

	test("malformed json falls back to the default instead of throwing", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), "{not json");
		expect(loadPrefs(env, tick())).toEqual(DEFAULTS);
	});

	test("CMD_COLORS overrides the file both ways", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"colors": true}');
		expect(loadPrefs({ ...env, CMD_COLORS: "1" }, tick()).colors).toBe(true);
		expect(loadPrefs({ ...env, CMD_COLORS: "0" }, tick()).colors).toBe(false);
		expect(loadPrefs({ ...env, CMD_COLORS: "nope" }, tick()).colors).toBe(true);
	});

	test("CMD_OC_PLAN overrides the file, and a colour override keeps the plan", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"ocPlan": "go-plus"}');
		expect(loadPrefs({ ...env, CMD_OC_PLAN: "go" }, tick()).ocPlan).toBe("go");
		// An unrecognised env value is ignored (with a warning), file stands.
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(loadPrefs({ ...env, CMD_OC_PLAN: "bogus" }, tick()).ocPlan).toBe("go-plus");
			// A per-run colour flag must not hide the configured plan.
			expect(loadPrefs({ ...env, CMD_COLORS: "0" }, tick()).ocPlan).toBe("go-plus");
		} finally {
			console.warn = warn;
		}
	});

	test("the OpenDesign section is on by default and only a real boolean flips it", () => {
		// Same default as the other three sections: an OpenDesign session gets its
		// block without a setting, and only that provider ever spawns `oduse`.
		expect(parsePrefs({}).od).toBe(true);
		expect(parsePrefs(undefined).od).toBe(true);
		expect(parsePrefs({ od: false }).od).toBe(false);
		expect(parsePrefs({ od: true }).od).toBe(true);
		// A hand-written string is not a boolean: warn and keep the default, rather
		// than reading `"no"` as on without saying so.
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(parsePrefs({ od: "no" }).od).toBe(true);
			expect(parsePrefs({ odPlan: "ultra" }).odPlan).toBe(OD_PLAN_DEFAULT);
		} finally {
			console.warn = warn;
		}
		expect(parsePrefs({}).odPlan).toBe("go");
		for (const plan of OD_PLANS) expect(parsePrefs({ odPlan: plan }).odPlan).toBe(plan);

		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"od": false, "odPlan": "pro"}');
		expect(loadPrefs(env, tick()).od).toBe(false);
		expect(loadPrefs(env, tick()).odPlan).toBe("pro");
	});

	test("CMD_OD and CMD_OD_PLAN override the file both ways", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), '{"od": false, "odPlan": "pro"}');
		expect(loadPrefs({ ...env, CMD_OD: "1" }, tick()).od).toBe(true);
		expect(loadPrefs({ ...env, CMD_OD: "0" }, tick()).od).toBe(false);
		expect(loadPrefs({ ...env, CMD_OD_PLAN: "max" }, tick()).odPlan).toBe("max");
		// A warn is expected for the bogus id; the file's value stands.
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(loadPrefs({ ...env, CMD_OD_PLAN: "bogus" }, tick()).odPlan).toBe("pro");
		} finally {
			console.warn = warn;
		}
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

	test("poll and cost-refresh intervals only take a value the dialog offers", () => {
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(parsePrefs({ pollMs: 5_000 }).pollMs).toBe(5_000);
			expect(parsePrefs({ pollMs: 60_000 }).pollMs).toBe(60_000);
			// A 1ms poll or a 0ms re-scan would hammer the disk, so it falls back.
			expect(parsePrefs({ pollMs: 1 }).pollMs).toBe(POLL_DEFAULT_MS);
			expect(parsePrefs({ pollMs: 7_000 }).pollMs).toBe(POLL_DEFAULT_MS);
			expect(parsePrefs({ costMs: 300_000 }).costMs).toBe(300_000);
			expect(parsePrefs({ costMs: 1_000 }).costMs).toBe(COST_REFRESH_DEFAULT_MS);
		} finally {
			console.warn = warn;
		}
		expect(parsePrefs({}).pollMs).toBe(POLL_DEFAULT_MS);
		expect(parsePrefs({}).costMs).toBe(COST_REFRESH_DEFAULT_MS);
		expect(parsePrefs(undefined).pollMs).toBe(POLL_DEFAULT_MS);
	});

	test("cost mode defaults to off and takes the three known values", () => {
		expect(parsePrefs({}).cost).toBe(COST_MODE_DEFAULT);
		expect(parsePrefs(undefined).cost).toBe("off");
		for (const mode of COST_MODES) expect(parsePrefs({ cost: mode }).cost).toBe(mode);
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(parsePrefs({ cost: "always" }).cost).toBe(COST_MODE_DEFAULT);
			expect(parsePrefs({ cost: 1 }).cost).toBe(COST_MODE_DEFAULT);
		} finally {
			console.warn = warn;
		}
	});

	test("savePrefs patches the file, keeps unknown keys and clears the cache", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), JSON.stringify({ colors: true, futureKey: "kept" }));
		expect(savePrefs({ pollMs: 30_000 }, env).pollMs).toBe(30_000);
		// No delay, no tick arithmetic: the cache is dropped by the write itself.
		expect(loadPrefs(env, tick())).toEqual({ ...DEFAULTS, colors: true, pollMs: 30_000 });
		expect(JSON.parse(readFileSync(prefsPath(env), "utf8"))).toEqual({
			colors: true,
			futureKey: "kept",
			pollMs: 30_000,
		});

		// Round-trip of every typed field, with the unknown key still standing.
		expect(
			savePrefs(
				{
					colors: false,
					ocPlan: "go-plus",
					od: true,
					odPlan: "max",
					cost: "window",
					costMs: 300_000,
				},
				env,
			),
		).toEqual({
			colors: false,
			ocPlan: "go-plus",
			od: true,
			odPlan: "max",
			pollMs: 30_000,
			cost: "window",
			costMs: 300_000,
		});
		expect(loadPrefs(env, tick()).cost).toBe("window");
		expect(JSON.parse(readFileSync(prefsPath(env), "utf8")).futureKey).toBe("kept");
	});

	test("a malformed existing file is replaced by valid json", () => {
		const { env } = configDir();
		writeFileSync(prefsPath(env), "{not json");
		expect(savePrefs({ colors: true }, env)).toEqual({ ...DEFAULTS, colors: true });
		expect(JSON.parse(readFileSync(prefsPath(env), "utf8"))).toEqual({ colors: true });
		expect(loadPrefs(env, tick()).colors).toBe(true);
	});
});
