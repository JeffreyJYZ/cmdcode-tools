import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPEN_DESIGN_SEED, parseModelList } from "../src/catalogOpenDesign";
import { OPEN_DESIGN_BASE } from "../src/constants/endpoints";
import { OPEN_DESIGN_PACKAGE, OPEN_DESIGN_PROVIDER_ID } from "../src/constants/providers";
import { applyModels, registerProvider } from "../src/providerOpenDesign";
import { commandCodeV2 } from "../src/v2";

type Provider = {
	id: string;
	name: string;
	package: string;
	activation: string;
	settings: Record<string, unknown>;
	integrationID?: string;
};

/** Mirrors the v2 provider editor: `update` gap-fills a missing record from its
 * own id, exactly as the host seeds one, so a test sees what the host stores. */
function fakeEditor() {
	const providers = new Map<string, Provider>();
	const models = new Map<string, unknown[]>();
	const record = (id: string): Provider => {
		const existing = providers.get(id);
		if (existing) return existing;
		const fresh: Provider = { id, name: id, package: "", activation: "auto", settings: {} };
		providers.set(id, fresh);
		return fresh;
	};
	const editor = {
		update(id: string, fn: (provider: Provider) => void) {
			fn(record(id));
		},
		models: {
			set(id: string, list: never) {
				models.set(id, list as unknown[]);
			},
		},
	};
	return { editor, providers, models };
}

describe("registerProvider", () => {
	test("no key: registers the lane as auto, right package and endpoint", () => {
		const { editor, providers, models } = fakeEditor();
		expect(() => registerProvider(editor, undefined)).not.toThrow();
		const provider = providers.get(OPEN_DESIGN_PROVIDER_ID);
		expect(provider?.name).toBe("OpenDesign");
		expect(provider?.package).toBe(OPEN_DESIGN_PACKAGE);
		expect(provider?.activation).toBe("auto");
		expect(provider?.settings.baseURL).toBe(OPEN_DESIGN_BASE);
		expect(provider?.settings.apiKey).toBeUndefined();
		expect(provider?.integrationID).toBe("open-design");
		expect(models.get(OPEN_DESIGN_PROVIDER_ID)?.length).toBe(OPEN_DESIGN_SEED.length);
	});
	test("a key enables the lane and is injected", () => {
		const { editor, providers } = fakeEditor();
		registerProvider(editor, "od-key");
		const provider = providers.get(OPEN_DESIGN_PROVIDER_ID);
		expect(provider?.activation).toBe("enabled");
		expect(provider?.settings.apiKey).toBe("od-key");
	});
	test("a user's own name and apiKey are never overwritten", () => {
		const { editor, providers } = fakeEditor();
		registerProvider(editor, "env-key");
		const mine = providers.get(OPEN_DESIGN_PROVIDER_ID);
		if (mine) {
			mine.name = "Mine";
			mine.settings.apiKey = "user-key";
		}
		registerProvider(editor, "env-key");
		expect(providers.get(OPEN_DESIGN_PROVIDER_ID)?.name).toBe("Mine");
		expect(providers.get(OPEN_DESIGN_PROVIDER_ID)?.settings.apiKey).toBe("user-key");
	});
});

describe("applyModels", () => {
	test("a live listing adds without deleting the seed", () => {
		const { editor, models } = fakeEditor();
		registerProvider(editor, "od-key");
		applyModels(editor, parseModelList({ data: [{ id: "gpt-6-luna" }] }));
		const after = models.get(OPEN_DESIGN_PROVIDER_ID) as Array<{ id: string }>;
		expect(after.map((m) => m.id)).toEqual([
			"deepseek-v4.1-flash",
			"deepseek-v4.1-flash-eco",
			"gpt-6-luna",
		]);
	});
});

describe("v2 registration", () => {
	const providerEditor = fakeEditor();
	const integrationEditor = {
		update(id: string, fn: (integration: { id: string; name: string }) => void) {
			fn({ id, name: id });
		},
		method: { update: () => {} },
	};
	const ctx = {
		integration: {
			transform: async (fn: (e: unknown) => void) => fn(integrationEditor),
			connection: { active: async () => undefined, resolve: async () => undefined },
		},
		aisdk: { hook: async () => {} },
		provider: { transform: async (fn: (e: unknown) => void) => fn(providerEditor.editor) },
		tool: { transform: async (fn: (e: unknown) => void) => fn({ add: () => {} }) },
	};

	test("setup registers open-design beside the Command Code lanes", async () => {
		process.env.CMD_API_KEY = "test-key";
		delete process.env.OPEN_DESIGN_API_KEY;
		process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "od-plugin-"));
		const stop = (await commandCodeV2.setup(ctx as never)) as () => void;
		expect(typeof stop).toBe("function");
		stop();
		const provider = providerEditor.providers.get(OPEN_DESIGN_PROVIDER_ID);
		expect(provider?.settings.baseURL).toBe(OPEN_DESIGN_BASE);
		expect(provider?.package).toBe(OPEN_DESIGN_PACKAGE);
		expect(provider?.activation).toBe("auto");
		const seeded = providerEditor.models.get(OPEN_DESIGN_PROVIDER_ID) as Array<{ id: string }>;
		expect(seeded.map((m) => m.id)).toContain("deepseek-v4.1-flash");
		expect(seeded.map((m) => m.id)).toContain("deepseek-v4.1-flash-eco");
	});

	afterAll(() => {
		delete process.env.CMD_API_KEY;
		delete process.env.OPEN_DESIGN_API_KEY;
		delete process.env.XDG_CACHE_HOME;
	});
});
