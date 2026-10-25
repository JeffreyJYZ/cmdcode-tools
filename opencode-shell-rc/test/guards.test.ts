import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFile, loadConfig, renderGuards, syncGuards } from "../src/guards";
import { restoreEnv } from "./helpers";

const saved = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "shell-rc-guards-"));
	process.env.HOME = dir;
	process.env.XDG_STATE_HOME = join(dir, "state");
	process.env.XDG_CONFIG_HOME = join(dir, "config");
});

afterEach(() => {
	restoreEnv("HOME", saved.HOME);
	restoreEnv("XDG_STATE_HOME", saved.XDG_STATE_HOME);
	restoreEnv("XDG_CONFIG_HOME", saved.XDG_CONFIG_HOME);
	rmSync(dir, { recursive: true, force: true });
});

const writeConfig = (body: unknown): void => {
	mkdirSync(join(dir, "config", "opencode"), { recursive: true });
	writeFileSync(configFile(), JSON.stringify(body));
};

describe("loadConfig", () => {
	test("blocks nothing by default — the guard layer is opt-in", () => {
		expect(loadConfig()).toEqual({ blocked: {} });
	});

	test("reads a configured list", () => {
		writeConfig({ blocked: { cat: "bat", find: "fd" } });
		expect(loadConfig()).toEqual({ blocked: { cat: "bat", find: "fd" } });
	});

	test("a malformed file blocks nothing rather than guessing", () => {
		mkdirSync(join(dir, "config", "opencode"), { recursive: true });
		writeFileSync(configFile(), "{not json");
		expect(loadConfig()).toEqual({ blocked: {} });
	});

	test("ignores entries whose replacement is not a string", () => {
		writeConfig({ blocked: { find: "fd", grep: 3 } });
		expect(loadConfig()).toEqual({ blocked: { find: "fd" } });
	});
});

describe("renderGuards", () => {
	test("writes a failing function that names the replacement", () => {
		const script = renderGuards({ find: "fd" }, () => true);
		expect(script).toContain("function find {");
		expect(script).toContain("use fd");
		expect(script).toContain("return 127");
	});

	test("skips a binary whose replacement is not installed", () => {
		expect(renderGuards({ find: "definitely-not-installed-xyz" })).not.toContain(
			"function find {",
		);
	});

	test("skips names that cannot be zsh function names", () => {
		expect(renderGuards({ "bad name": "fd" }, () => true)).not.toContain("function bad name");
	});

	test("never blocks cat, even when a config asks for it", () => {
		// cat emits raw bytes; bat reformats, so the output stops being the file.
		expect(renderGuards({ cat: "bat" }, () => true)).not.toContain("function cat");
	});
});

describe("syncGuards", () => {
	test("writes nothing when nothing is blocked, and removes a stale file", () => {
		const path = join(dir, "state", "opencode", "shell-rc", "guards.zsh");
		// Default config: no guards, no file at all — the shim's `-f` test skips it.
		expect(syncGuards(() => true)).toBe(false);
		mkdirSync(join(dir, "state", "opencode", "shell-rc"), { recursive: true });
		writeFileSync(path, "function grep { return 127 }\n");
		expect(syncGuards(() => true)).toBe(true);
		expect(() => readFileSync(path, "utf8")).toThrow();
	});

	test("writes the script and is idempotent", () => {
		writeConfig({ blocked: { grep: "rg" } });
		expect(syncGuards(() => true)).toBe(true);
		const path = join(dir, "state", "opencode", "shell-rc", "guards.zsh");
		const first = readFileSync(path, "utf8");
		expect(syncGuards(() => true)).toBe(false);
		expect(readFileSync(path, "utf8")).toBe(first);
	});

	test("follows a config edit", () => {
		syncGuards(() => true);
		writeConfig({ blocked: { ack: "rg" } });
		expect(syncGuards(() => true)).toBe(true);
		const path = join(dir, "state", "opencode", "shell-rc", "guards.zsh");
		expect(readFileSync(path, "utf8")).toContain("function ack {");
	});
});

test("the shim sources the guards after the alias state", async () => {
	const { shimContent } = await import("../src/shim");
	const shim = shimContent();
	const state = shim.indexOf("state.zsh");
	const guards = shim.indexOf("guards.zsh");
	expect(state).toBeGreaterThan(-1);
	expect(guards).toBeGreaterThan(state);
});

describe("the generated script in a real shell", () => {
	const hasZsh = Bun.which("zsh") !== null;

	test.skipIf(!hasZsh)(
		"still defines the function when the shell already aliased the name",
		() => {
			writeConfig({ blocked: { grep: "rg" } });
			syncGuards();
			const path = join(dir, "state", "opencode", "shell-rc", "guards.zsh");
			// oh-my-zsh ships `alias grep='grep --color=auto'`; zsh refuses a
			// function whose name is an alias, which silently left grep unblocked.
			let stderr = "";
			try {
				execFileSync(
					"zsh",
					["-f", "-c", `alias grep='grep --color=auto'; source ${path}; grep --version`],
					{ stdio: ["ignore", "pipe", "pipe"] },
				);
			} catch (error) {
				stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
			}
			expect(stderr).toContain("use rg");
			expect(stderr).not.toContain("parse error");
			expect(stderr).not.toContain("based on alias");
		},
	);

	test.skipIf(!hasZsh)("blocks the binary and leaves the real one reachable", () => {
		writeConfig({ blocked: { grep: "rg" } });
		syncGuards();
		const path = join(dir, "state", "opencode", "shell-rc", "guards.zsh");
		// `grep` as a command is the function now; `command grep` is the binary.
		let status = 0;
		let stderr = "";
		try {
			execFileSync("zsh", ["-f", "-c", `source ${path}; grep --version`], {
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			const failed = error as { status?: number; stderr?: Buffer };
			status = failed.status ?? 0;
			stderr = failed.stderr?.toString() ?? "";
		}
		expect(status).toBe(127);
		expect(stderr).toContain("use rg");

		const real = execFileSync(
			"zsh",
			["-f", "-c", `source ${path}; command grep --version | head -1`],
			{ encoding: "utf8" },
		);
		expect(real.length).toBeGreaterThan(0);
	});
});
