import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isZsh,
	needsRefresh,
	prepare,
	shimContent,
	stateDir,
	stateFile,
} from "../src/shim";

const saved = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "shell-rc-test-"));
	process.env.HOME = dir;
	process.env.XDG_STATE_HOME = join(dir, "state");
});

afterEach(() => {
	process.env.HOME = saved.HOME;
	process.env.XDG_STATE_HOME = saved.XDG_STATE_HOME;
	rmSync(dir, { recursive: true, force: true });
});

describe("stateDir", () => {
	test("honours XDG_STATE_HOME", () => {
		expect(stateDir()).toBe(join(dir, "state", "opencode", "shell-rc"));
	});

	test("falls back under HOME without XDG_STATE_HOME", () => {
		delete process.env.XDG_STATE_HOME;
		expect(stateDir()).toBe(
			join(dir, ".local", "state", "opencode", "shell-rc"),
		);
	});
});

describe("shimContent", () => {
	test("sources the real zshenv, the generated state and the escape hatch", () => {
		const content = shimContent();
		expect(content).toContain('source "$HOME/.zshenv"');
		expect(content).toContain('source "$ZDOTDIR/state.zsh"');
		expect(content).toContain('source "$HOME/.config/opencode/shell.zsh"');
	});
});

describe("isZsh", () => {
	test("matches zsh by name and path, rejects others", () => {
		for (const shell of ["zsh", "/bin/zsh", "/usr/local/bin/zsh", "zsh.exe"]) {
			expect(isZsh(shell)).toBe(true);
		}
		for (const shell of ["sh", "bash", "/bin/sh", "fish", "powershell.exe"]) {
			expect(isZsh(shell)).toBe(false);
		}
	});
});

describe("needsRefresh", () => {
	test("missing state always refreshes", () => {
		expect(needsRefresh(undefined, [])).toBe(true);
	});

	test("refresh only when a source is newer", () => {
		expect(needsRefresh(100, [50, 90])).toBe(false);
		expect(needsRefresh(100, [50, 150])).toBe(true);
		expect(needsRefresh(100, [])).toBe(false);
	});
});

describe("prepare", () => {
	test("writes the shim and state file", () => {
		writeFileSync(join(dir, ".zshrc"), "alias gp='echo FAKE_PUSH'\n");
		prepare();
		expect(stateDir()).toStartWith(join(dir, "state"));
		expect(stateFile().startsWith(join(dir, "state"))).toBe(true);
	});

	test("fails open when zsh is not on PATH", () => {
		writeFileSync(join(dir, ".zshrc"), "alias gp='echo FAKE_PUSH'\n");
		const savedPath = process.env.PATH;
		// Point PATH at an empty dir so `zsh` cannot be found — generation must
		// not throw (CI has no zsh), and prepare() should still lay down the shim.
		mkdirSync(join(dir, "empty-bin"));
		process.env.PATH = join(dir, "empty-bin");
		try {
			expect(() => prepare()).not.toThrow();
		} finally {
			process.env.PATH = savedPath;
		}
	});

	const hasZsh = Bun.which("zsh") !== null;
	test.skipIf(!hasZsh)(
		"aliases from ~/.zshrc resolve in a shimmed non-interactive zsh",
		() => {
			writeFileSync(join(dir, ".zshrc"), "alias gp='echo FAKE_PUSH'\n");
			prepare();
			expect(existsSync(`${stateFile()}.zwc`)).toBe(true);
			const output = execFileSync("zsh", ["-c", "gp"], {
				env: { ...process.env, ZDOTDIR: stateDir() },
				encoding: "utf8",
			});
			expect(output.trim()).toBe("FAKE_PUSH");
		},
	);
});
