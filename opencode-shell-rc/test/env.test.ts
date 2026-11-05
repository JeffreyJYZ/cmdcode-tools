import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, renderEnv, syncEnv } from "../src/env";
import { configFile } from "../src/guards";
import { shimContent } from "../src/shim";
import { restoreEnv } from "./helpers";

const saved = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "shell-rc-env-"));
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

const envFile = (): string => join(dir, "state", "opencode", "shell-rc", "env.zsh");

describe("loadEnv", () => {
	test("is empty without a config file", () => {
		expect(loadEnv()).toEqual({});
	});

	test("reads valid entries and drops the rest", () => {
		writeConfig({
			env: { EDITOR: "zed", "not-a-name": "x", "1BAD": "x", NUM: 7, EMPTY: "" },
		});
		expect(loadEnv()).toEqual({ EDITOR: "zed", EMPTY: "" });
	});

	test("survives a malformed config", () => {
		mkdirSync(join(dir, "config", "opencode"), { recursive: true });
		writeFileSync(configFile(), "{ nope");
		expect(loadEnv()).toEqual({});
	});

	test("coexists with the guard block in the same file", () => {
		writeConfig({ blocked: { grep: "rg" }, env: { FOO: "bar" } });
		expect(loadEnv()).toEqual({ FOO: "bar" });
	});
});

describe("renderEnv", () => {
	test("exports one variable per line", () => {
		expect(renderEnv({ A: "1", B: "2" })).toContain("export A='1'\nexport B='2'");
	});

	test("single-quotes so spaces, dollars and backticks stay literal", () => {
		const script = renderEnv({ T: "a b $HOME `id` \\n" });
		expect(script).toContain(`export T='a b $HOME \`id\` \\n'`);
	});

	test("escapes an embedded single quote", () => {
		expect(renderEnv({ Q: "it's" })).toContain(`export Q='it'\\''s'`);
	});

	test("emits no export lines when empty", () => {
		expect(renderEnv({})).not.toContain("export ");
	});
});

describe("syncEnv", () => {
	test("writes the file when the config names variables", () => {
		writeConfig({ env: { FOO: "bar" } });
		expect(syncEnv()).toBe(true);
		expect(readFileSync(envFile(), "utf8")).toContain("export FOO='bar'");
	});

	test("is idempotent", () => {
		writeConfig({ env: { FOO: "bar" } });
		syncEnv();
		expect(syncEnv()).toBe(false);
	});

	test("removes the file when the variables go away", () => {
		writeConfig({ env: { FOO: "bar" } });
		syncEnv();
		writeConfig({ env: {} });
		expect(syncEnv()).toBe(true);
		expect(() => readFileSync(envFile(), "utf8")).toThrow();
	});

	test("writes nothing without a config", () => {
		expect(syncEnv()).toBe(false);
	});
});

describe("shim", () => {
	test("sources env.zsh only in a non-interactive shell", () => {
		expect(shimContent()).toContain('source "$ZDOTDIR/env.zsh"');
	});
});
