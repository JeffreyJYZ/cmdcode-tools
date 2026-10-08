import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin as PluginNs } from "@opencode/plugin";
import { SHELL_RC_ID } from "../src/constants/shell-rc";
import plugin, { shellRcPlugin } from "../src/index";
import { type ShellCreateBefore, stateDir } from "./helpers";

const saved = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "shell-rc-plugin-"));
	process.env.HOME = dir;
	process.env.XDG_STATE_HOME = join(dir, "state");
});

afterEach(() => {
	process.env.HOME = saved.HOME;
	process.env.XDG_STATE_HOME = saved.XDG_STATE_HOME;
	rmSync(dir, { recursive: true, force: true });
});

/** Run setup but capture the registered `create.before` callback instead. */
async function register(): Promise<(event: ShellCreateBefore) => unknown> {
	let captured: ((event: ShellCreateBefore) => unknown) | undefined;
	const context = {
		shell: {
			hook: async (
				_name: string,
				callback: (event: ShellCreateBefore) => unknown,
			) => {
				captured = callback;
				return { dispose: async () => {} };
			},
		},
	} as unknown as PluginNs.Context;
	await shellRcPlugin.setup(context);
	if (!captured) throw new Error("create.before hook was not registered");
	return captured;
}

describe("plugin shape", () => {
	test("exposes id and setup", () => {
		expect(plugin.id).toBe(SHELL_RC_ID);
		expect(typeof plugin.setup).toBe("function");
	});
});

describe("create.before hook", () => {
	const hasZsh = Bun.which("zsh") !== null;

	test.skipIf(!hasZsh)("sets ZDOTDIR for a zsh shell", async () => {
		writeFileSync(join(dir, ".zshrc"), "alias gp='echo FAKE_PUSH'\n");
		const hook = await register();
		const event: ShellCreateBefore = {
			command: "gp",
			cwd: dir,
			timeout: 0,
			shell: "/bin/zsh",
			env: {},
		};
		await hook(event);
		expect(event.env.ZDOTDIR).toBe(stateDir());
	});

	test("leaves non-zsh shells untouched", async () => {
		const hook = await register();
		const event: ShellCreateBefore = {
			command: "echo hi",
			cwd: dir,
			timeout: 0,
			shell: "/bin/bash",
			env: {},
		};
		await hook(event);
		expect(event.env.ZDOTDIR).toBeUndefined();
	});
});
