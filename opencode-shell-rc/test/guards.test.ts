import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFile, loadConfig, normalizeBlocked, renderGuards, syncGuards } from "../src/guards";
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

const guardsPath = (): string => join(dir, "state", "opencode", "shell-rc", "guards.zsh");

describe("normalizeBlocked", () => {
	test("normalises the array form, trimming each field", () => {
		expect(
			normalizeBlocked([
				{ name: " grep ", alternative: " rg ", reason: " faster " },
				{ name: "tccutil", reason: "human-only" },
			]),
		).toEqual([
			{ name: "grep", alternative: "rg", reason: "faster" },
			{ name: "tccutil", reason: "human-only" },
		]);
	});

	test("normalises the legacy string map to alternatives", () => {
		expect(normalizeBlocked({ cat: "bat", find: "fd" })).toEqual([
			{ name: "cat", alternative: "bat" },
			{ name: "find", alternative: "fd" },
		]);
	});

	test("drops malformed entries and keeps the rest in order", () => {
		expect(
			normalizeBlocked([
				null,
				"grep",
				{ alternative: "rg" },
				{ name: "find", alternative: 3, reason: "" },
				{ name: "sed", alternative: "sd" },
			]),
		).toEqual([{ name: "sed", alternative: "sd" }]);
	});

	test("a later duplicate wins", () => {
		expect(
			normalizeBlocked([
				{ name: "grep", alternative: "rg", reason: "first" },
				{ name: "sed", alternative: "sd" },
				{ name: "grep", alternative: "ag", reason: "second" },
			]),
		).toEqual([
			{ name: "sed", alternative: "sd" },
			{ name: "grep", alternative: "ag", reason: "second" },
		]);
	});

	test("anything else falls back to the empty list", () => {
		expect(normalizeBlocked(undefined)).toEqual([]);
		expect(normalizeBlocked(null)).toEqual([]);
		expect(normalizeBlocked("grep")).toEqual([]);
		expect(normalizeBlocked(3)).toEqual([]);
	});
});

describe("loadConfig", () => {
	test("blocks nothing by default — the guard layer is opt-in", () => {
		expect(loadConfig()).toEqual({ blocked: [] });
	});

	test("reads the array form", () => {
		writeConfig({ blocked: [{ name: "grep", alternative: "rg" }] });
		expect(loadConfig()).toEqual({ blocked: [{ name: "grep", alternative: "rg" }] });
	});

	test("still reads the legacy string map", () => {
		writeConfig({ blocked: { find: "fd", grep: "rg" } });
		expect(loadConfig()).toEqual({
			blocked: [
				{ name: "find", alternative: "fd" },
				{ name: "grep", alternative: "rg" },
			],
		});
	});

	test("a malformed file blocks nothing rather than guessing", () => {
		mkdirSync(join(dir, "config", "opencode"), { recursive: true });
		writeFileSync(configFile(), "{not json");
		expect(loadConfig()).toEqual({ blocked: [] });
	});

	test("a blocked that is neither array nor object blocks nothing", () => {
		writeConfig({ blocked: "grep" });
		expect(loadConfig()).toEqual({ blocked: [] });
	});

	test("ignores entries whose alternative is not a string", () => {
		writeConfig({
			blocked: [
				{ name: "find", alternative: "fd" },
				{ name: "grep", alternative: 3 },
			],
		});
		expect(loadConfig()).toEqual({ blocked: [{ name: "find", alternative: "fd" }] });
	});

	test("resolves duplicates through the normaliser", () => {
		writeConfig({
			blocked: [
				{ name: "grep", alternative: "rg" },
				{ name: "grep", alternative: "ag" },
			],
		});
		expect(loadConfig()).toEqual({ blocked: [{ name: "grep", alternative: "ag" }] });
	});
});

describe("renderGuards", () => {
	test("writes a failing function that names the replacement", () => {
		const script = renderGuards([{ name: "find", alternative: "fd" }], () => true);
		expect(script).toContain("function find {");
		expect(script).toContain("unalias find 2>/dev/null");
		expect(script).toContain("use fd");
		expect(script).toContain("return 127");
	});

	test("appends a reason in parentheses when the alternative resolves on PATH", () => {
		const script = renderGuards(
			[{ name: "grep", alternative: "rg", reason: "respects .gitignore and is faster" }],
			(command) => command === "rg",
		);
		expect(script).toContain(
			"grep is blocked in agent shells — use rg (respects .gitignore and is faster)",
		);
	});

	test("keeps an alternative's own trailing parentheses as written", () => {
		const script = renderGuards(
			[{ name: "sed", alternative: "sd (or read for line ranges)" }],
			() => true,
		);
		expect(script).toContain(
			"sed is blocked in agent shells — use sd (or read for line ranges)",
		);
	});

	test("keeps `use` when the alternative resolves on PATH", () => {
		const script = renderGuards(
			[{ name: "find", alternative: "fd" }],
			(command) => command === "fd",
		);
		expect(script).toContain("find is blocked in agent shells — use fd");
	});

	test("a reason alone is printed with no `use`", () => {
		const script = renderGuards(
			[{ name: "tccutil", reason: "TCC changes are human-only; ask the user" }],
			() => true,
		);
		expect(script).toContain(
			"tccutil is blocked in agent shells — TCC changes are human-only; ask the user",
		);
		expect(script).not.toContain("use TCC");
		expect(script).toContain("return 127");
	});

	test("writes a sentence alternative whose first word is not installed", () => {
		// The 0.4.3 case: the value is already a sentence, so it is printed verbatim.
		const script = renderGuards(
			[{ name: "tccutil", alternative: "TCC changes are human-only; ask the user" }],
			() => false,
		);
		expect(script).toContain("function tccutil {");
		expect(script).toContain(
			"tccutil is blocked in agent shells — TCC changes are human-only; ask the user",
		);
		expect(script).not.toContain("use TCC");
		expect(script).toContain("return 127");
	});

	test("an alternative not on PATH falls back to the reason", () => {
		const script = renderGuards(
			[{ name: "tccutil", alternative: "tcc", reason: "ask the user" }],
			() => false,
		);
		expect(script).toContain("tccutil is blocked in agent shells — ask the user");
		expect(script).not.toContain("use tcc");
	});

	test("skips an entry with neither an alternative nor a reason", () => {
		expect(renderGuards([{ name: "grep" }], () => true)).not.toContain("function grep {");
	});

	test("skips an entry whose alternative and reason are blank", () => {
		expect(
			renderGuards([{ name: "find", alternative: "   ", reason: "" }], () => true),
		).not.toContain("function find {");
	});

	test("skips names that cannot be zsh function names", () => {
		expect(renderGuards([{ name: "bad name", alternative: "fd" }], () => true)).not.toContain(
			"function bad name",
		);
	});

	test("never blocks cat, even when a config asks for it", () => {
		// cat emits raw bytes; bat reformats, so the output stops being the file.
		expect(renderGuards([{ name: "cat", alternative: "bat" }], () => true)).not.toContain(
			"function cat",
		);
	});

	test("still renders the legacy string map", () => {
		const script = renderGuards({ find: "fd" }, () => true);
		expect(script).toContain("function find {");
		expect(script).toContain("use fd");
	});

	test("a later duplicate wins", () => {
		const script = renderGuards(
			[
				{ name: "grep", alternative: "rg" },
				{ name: "grep", alternative: "ag" },
			],
			() => true,
		);
		expect(script).toContain("use ag");
		expect(script).not.toContain("use rg");
		expect(script.match(/function grep \{/g)).toHaveLength(1);
	});

	test('escapes `\\`, `"`, `$` and the backtick in a reason', () => {
		const reason = 'say "hi" $HOME `whoami` and C:\\tmp';
		const escaped = 'say \\"hi\\" \\$HOME \\`whoami\\` and C:\\\\tmp';
		const script = renderGuards([{ name: "grep", alternative: "rg", reason }], () => true);
		expect(script).toContain(`use rg (${escaped})`);
		// The reason carries two backticks (opening and closing); both are inert.
		expect(script.match(/\\`/g)?.length).toBe(2);
	});
});

describe("syncGuards", () => {
	test("writes nothing when nothing is blocked, and removes a stale file", () => {
		const path = guardsPath();
		// Default config: no guards, no file at all — the shim's `-f` test skips it.
		expect(syncGuards(() => true)).toBe(false);
		mkdirSync(join(dir, "state", "opencode", "shell-rc"), { recursive: true });
		writeFileSync(path, "function grep { return 127 }\n");
		expect(syncGuards(() => true)).toBe(true);
		expect(() => readFileSync(path, "utf8")).toThrow();
	});

	test("writes the array-form script and is idempotent", () => {
		writeConfig({ blocked: [{ name: "grep", alternative: "rg" }] });
		expect(syncGuards(() => true)).toBe(true);
		const path = guardsPath();
		const first = readFileSync(path, "utf8");
		expect(first).toContain("function grep {");
		expect(syncGuards(() => true)).toBe(false);
		expect(readFileSync(path, "utf8")).toBe(first);
	});

	test("still follows a legacy-map config edit", () => {
		syncGuards(() => true);
		writeConfig({ blocked: { ack: "rg" } });
		expect(syncGuards(() => true)).toBe(true);
		expect(readFileSync(guardsPath(), "utf8")).toContain("function ack {");
	});

	test("writes a sentence alternative even with no binary on PATH", () => {
		writeConfig({
			blocked: [{ name: "tccutil", alternative: "TCC changes are human-only; ask the user" }],
		});
		expect(syncGuards(() => false)).toBe(true);
		const script = readFileSync(guardsPath(), "utf8");
		expect(script).toContain("function tccutil {");
		expect(script).toContain(
			"tccutil is blocked in agent shells — TCC changes are human-only; ask the user",
		);
		expect(script).not.toContain("use TCC");
	});

	test("writes the escaped reason verbatim into the script", () => {
		const reason = 'say "hi" $HOME `whoami` and C:\\tmp';
		writeConfig({ blocked: [{ name: "grep", alternative: "rg", reason }] });
		expect(syncGuards(() => true)).toBe(true);
		const script = readFileSync(guardsPath(), "utf8");
		expect(script).toContain('say \\"hi\\" \\$HOME \\`whoami\\` and C:\\\\tmp');
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
			writeConfig({ blocked: [{ name: "grep", alternative: "rg" }] });
			syncGuards();
			const path = guardsPath();
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
		writeConfig({ blocked: [{ name: "grep", alternative: "rg" }] });
		syncGuards();
		const path = guardsPath();
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

	test.skipIf(!hasZsh)("a reason alone refuses the command with its own message", () => {
		writeConfig({
			blocked: [{ name: "tccutil", reason: "TCC changes are human-only; ask the user" }],
		});
		syncGuards(() => false);
		const path = guardsPath();
		let status = 0;
		let stderr = "";
		try {
			execFileSync("zsh", ["-f", "-c", `source ${path}; tccutil`], {
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			const failed = error as { status?: number; stderr?: Buffer };
			status = failed.status ?? 0;
			stderr = failed.stderr?.toString() ?? "";
		}
		expect(status).toBe(127);
		expect(stderr).toContain(
			"tccutil is blocked in agent shells — TCC changes are human-only; ask the user",
		);
		expect(stderr).not.toContain("use ");
	});

	test.skipIf(!hasZsh)("a reason with quotes and `$` prints literally, without executing", () => {
		const reason = 'say "hi" $HOME `whoami` and C:\\tmp';
		writeConfig({ blocked: [{ name: "grep", alternative: "rg", reason }] });
		syncGuards(() => true);
		const path = guardsPath();
		let stderr = "";
		try {
			execFileSync("zsh", ["-f", "-c", `source ${path}; grep`], {
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
		}
		expect(stderr).toContain('use rg (say "hi" $HOME `whoami` and C:\\tmp)');
		expect(stderr).not.toContain("parse error");
	});
});
