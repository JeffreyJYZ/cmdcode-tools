import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin as PluginNs } from "@opencode/plugin";
import plugin, { sessionDirPlugin } from "../src/index";
import { addBinding, invalidateCache } from "../src/state";

const saved = {
	HOME: process.env.HOME,
	XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "session-dir-plugin-"));
	process.env.HOME = dir;
	process.env.XDG_DATA_HOME = join(dir, "data");
	delete process.env.OPENCODE_SESSION_DIR_INJECT_CONTEXT;
	invalidateCache();
});

afterEach(() => {
	process.env.HOME = saved.HOME;
	process.env.XDG_DATA_HOME = saved.XDG_DATA_HOME;
	invalidateCache();
	rmSync(dir, { recursive: true, force: true });
});

interface Captured {
	evaluate: (event: any) => unknown;
	context: (event: any) => unknown;
}

async function register(): Promise<Captured> {
	let evaluate: ((event: any) => unknown) | undefined;
	let context: ((event: any) => unknown) | undefined;
	const ctx = {
		permission: {
			hook: async (_name: string, callback: (event: any) => unknown) => {
				evaluate = callback;
				return { dispose: async () => {} };
			},
		},
		session: {
			hook: async (_name: string, callback: (event: any) => unknown) => {
				context = callback;
				return { dispose: async () => {} };
			},
		},
	} as unknown as PluginNs.Context;
	await sessionDirPlugin.setup(ctx);
	if (!evaluate || !context) throw new Error("hooks were not registered");
	return { evaluate, context };
}

describe("plugin shape", () => {
	test("exposes id and setup", () => {
		expect(plugin.id).toBe("opencode-session-dir");
		expect(typeof plugin.setup).toBe("function");
	});
});

describe("permission.evaluate", () => {
	test("allows external_directory only for the binding's own session", async () => {
		addBinding("ses_a", "/bound");
		const { evaluate } = await register();

		const own = {
			action: "external_directory",
			effect: "ask",
			sessionID: "ses_a",
			resources: ["/bound/sub/*"],
		};
		await evaluate(own);
		expect(own.effect).toBe("allow");

		const other = {
			action: "external_directory",
			effect: "ask",
			sessionID: "ses_b",
			resources: ["/bound/sub/*"],
		};
		await evaluate(other);
		expect(other.effect).toBe("ask");
	});

	test("leaves other actions and effects untouched", async () => {
		addBinding("ses_a", "/bound");
		const { evaluate } = await register();

		const notExternal = {
			action: "read",
			effect: "ask",
			sessionID: "ses_a",
			resources: ["/bound/*"],
		};
		await evaluate(notExternal);
		expect(notExternal.effect).toBe("ask");

		const alreadyDenied = {
			action: "external_directory",
			effect: "deny",
			sessionID: "ses_a",
			resources: ["/bound/*"],
		};
		await evaluate(alreadyDenied);
		expect(alreadyDenied.effect).toBe("deny");
	});

	test("leaves resources outside the binding untouched", async () => {
		addBinding("ses_a", "/bound");
		const { evaluate } = await register();

		const outside = {
			action: "external_directory",
			effect: "ask",
			sessionID: "ses_a",
			resources: ["/elsewhere/*"],
		};
		await evaluate(outside);
		expect(outside.effect).toBe("ask");
	});

	test("sibling prefix is not treated as inside", async () => {
		addBinding("ses_a", "/bound");
		const { evaluate } = await register();

		const sibling = {
			action: "external_directory",
			effect: "ask",
			sessionID: "ses_a",
			resources: ["/boundary/*"],
		};
		await evaluate(sibling);
		expect(sibling.effect).toBe("ask");
	});
});

describe("session.context", () => {
	test("injects bound directories for the owning session only", async () => {
		addBinding("ses_a", "/bound");
		const { context } = await register();

		const a = { sessionID: "ses_a", system: [] as Array<{ text: string }> };
		await context(a);
		expect(a.system).toHaveLength(1);
		expect(a.system[0]?.text).toContain("/bound");

		const b = { sessionID: "ses_b", system: [] as Array<{ text: string }> };
		await context(b);
		expect(b.system).toHaveLength(0);
	});
});
