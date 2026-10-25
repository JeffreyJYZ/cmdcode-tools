import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { canonicalizeModelId, evaluateModelAccess } from "../src/access";
import { MODEL_CATEGORIES, PLAN_RULES } from "../src/constants/gating";
import {
	ARKUSE_TOOL_ARG_DESCRIPTION,
	ARKUSE_TOOL_DESCRIPTION,
	MPC_TOOL_ARG_DESCRIPTION,
	MPC_TOOL_DESCRIPTION,
	OCUSE_TOOL_ARG_DESCRIPTION,
	OCUSE_TOOL_DESCRIPTION,
	TOOL_DESCRIPTION,
} from "../src/constants/providers";
import { isClaude, splitModels } from "../src/models";
import { commandCodeV2 } from "../src/v2";

// Neither plugin half may touch the network or the auth store from a test.
// `CMD_API_KEY` is `resolveKey`'s own first choice, so setting it keeps the v1
// half's config hook offline without patching a module. It must not be a
// `mock.module`: Bun module mocks are process-wide, and the one this replaced
// leaked into v2.test.ts and made its no-connection fallback return undefined
// (green locally, red in CI).
process.env.CMD_API_KEY = "test-key";

afterAll(() => {
	delete process.env.CMD_API_KEY;
});

// money/compact/relTime/parseIsoUtc and the plan name/cap table left the TS
// port with the cmduse-CLI delegation (src/usage.ts removed) — the Rust core
// is now the only implementation. The gating access layer stays TS and is
// pinned by conformance.test.ts (shared vectors). This file covers only
// TS-specific logic: canonicalization, wire split, and gating edges not
// represented as vectors.

const goat = { planId: "individual-goat", purchasedCredits: 0, freeCredits: 0 };

describe("canonicalizeModelId", () => {
	test("exact", () => {
		expect(canonicalizeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
	});
	test("case-insensitive", () => {
		expect(canonicalizeModelId("minimaxai/minimax-m2.5")).toBe("MiniMaxAI/MiniMax-M2.5");
	});
	test("deprecated alias", () => {
		expect(canonicalizeModelId("claude-opus-4-6")).toBe("claude-opus-4-7");
		expect(canonicalizeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5-20251001");
	});
	test("date suffix stripped", () => {
		expect(canonicalizeModelId("claude-opus-4-7-20251101")).toBe("claude-opus-4-7");
	});
	test("unknown passes through", () => {
		expect(canonicalizeModelId("totally-new-model")).toBe("totally-new-model");
	});
});

describe("gating tables match CLI", () => {
	test("go plan blocks muse-spark-1.2 + grok-4.6", () => {
		const rules = PLAN_RULES["individual-go"];
		expect(rules?.allowedCategories).toEqual(["opensource"]);
		expect(rules?.blockedModels).toContain("vercel-ai-gateway:meta/muse-spark-1.2");
		expect(rules?.blockedModels).toContain("vercel-ai-gateway:xai/grok-4.6");
	});
	test("pro blocks opus + fable, allows sonnet", () => {
		const rules = PLAN_RULES["individual-pro"];
		expect(rules?.blockedModels).toContain("anthropic:claude-opus-5");
		expect(rules?.blockedModels).toContain("anthropic:claude-fable-5");
	});
	test("categories", () => {
		expect(MODEL_CATEGORIES["claude-sonnet-5"]).toBe("premium");
		expect(MODEL_CATEGORIES["deepseek/deepseek-v4-flash"]).toBe("opensource");
	});
});

describe("evaluateModelAccess (edges beyond conformance vectors)", () => {
	test("newer sibling of premium model inherits premium (claude-fable-5-1)", () => {
		expect(evaluateModelAccess("claude-fable-5-1", goat).allowed).toBe(false);
	});
	test("version-bumped id with no prefix sibling defaults to allow (API enforces)", () => {
		expect(evaluateModelAccess("claude-sonnet-6", goat).allowed).toBe(true);
	});
	test("unprefixed unknown model on gated plan defaults opensource", () => {
		expect(evaluateModelAccess("newvendor/new-open-model", goat).allowed).toBe(true);
	});
	test("empirically hard-blocked model on GOAT (API 403 MODEL_NOT_IN_PLAN)", () => {
		expect(evaluateModelAccess("meta/muse-spark-1.1", goat).allowed).toBe(false);
	});
	test("purchased credits override hard block", () => {
		expect(
			evaluateModelAccess("meta/muse-spark-1.1", {
				...goat,
				purchasedCredits: 5,
			}).allowed,
		).toBe(true);
	});
});

describe("wire split", () => {
	test("claude detection", () => {
		expect(isClaude("claude-sonnet-5")).toBe(true);
		expect(isClaude("claude-opus-4-7")).toBe(true);
		expect(isClaude("openai/gpt-5.5")).toBe(false);
		expect(isClaude("deepseek/deepseek-v4-flash")).toBe(false);
	});
	test("splitModels sorts lanes", () => {
		const { claude, open } = splitModels([
			{ id: "claude-sonnet-5", name: "Sonnet", contextLength: 1 },
			{ id: "gpt-5.5", name: "GPT", contextLength: 1 },
		]);
		expect(claude.map((m) => m.id)).toEqual(["claude-sonnet-5"]);
		expect(open.map((m) => m.id)).toEqual(["gpt-5.5"]);
	});
});

describe("tool registrations", () => {
	test("v1 registers mpc_prices beside cmd_usage", async () => {
		const { CommandCodePlugin } = await import("../src/index");
		type ToolEntry = { description: string; args: z.ZodRawShape };
		const plugin = await (
			CommandCodePlugin as unknown as (input: unknown) => Promise<{
				tool: Record<
					"cmd_usage" | "mpc_prices" | "ocuse_usage" | "arkuse_usage",
					ToolEntry
				>;
			}>
		)({});
		expect(Object.keys(plugin.tool).sort()).toEqual([
			"arkuse_usage",
			"cmd_usage",
			"mpc_prices",
			"ocuse_usage",
		]);
		expect(plugin.tool.cmd_usage.description).toBe(TOOL_DESCRIPTION);
		expect(plugin.tool.mpc_prices.description).toBe(MPC_TOOL_DESCRIPTION);
		expect(plugin.tool.ocuse_usage.description).toBe(OCUSE_TOOL_DESCRIPTION);
		expect(plugin.tool.arkuse_usage.description).toBe(ARKUSE_TOOL_DESCRIPTION);
		const schema = z.object(plugin.tool.mpc_prices.args);
		expect(schema.parse({})).toEqual({});
		expect(schema.parse({ arg: "--json" })).toEqual({ arg: "--json" });
		expect(() => schema.parse({ arg: 1 })).toThrow();
	});
	test("v2 registers mpc_prices in the tool transform", async () => {
		process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "cc-plugin-"));
		const added: Array<{
			name: string;
			description: string;
			input: { properties: { arg: { description: string } } };
		}> = [];
		const editor = {
			update: () => {},
			models: { set: () => {} },
			method: { update: () => {} },
			add: (tool: (typeof added)[number]) => added.push(tool),
		};
		const ctx = {
			integration: {
				transform: async (fn: (e: unknown) => void) => fn(editor),
				connection: {
					active: async () => undefined,
					resolve: async () => undefined,
				},
			},
			aisdk: { hook: async () => {} },
			provider: {
				transform: async (fn: (e: unknown) => void) => fn(editor),
			},
			tool: {
				transform: async (fn: (e: unknown) => void) => fn(editor),
			},
		};
		const stop = (await commandCodeV2.setup(ctx as never)) as () => void;
		stop();
		expect(added.map((t) => t.name)).toEqual([
			"cmd_usage",
			"mpc_prices",
			"ocuse_usage",
			"arkuse_usage",
		]);
		const mpc = added.find((t) => t.name === "mpc_prices");
		expect(mpc?.description).toBe(MPC_TOOL_DESCRIPTION);
		expect(mpc?.input.properties.arg.description).toBe(MPC_TOOL_ARG_DESCRIPTION);
		const ocuse = added.find((t) => t.name === "ocuse_usage");
		expect(ocuse?.description).toBe(OCUSE_TOOL_DESCRIPTION);
		expect(ocuse?.input.properties.arg.description).toBe(OCUSE_TOOL_ARG_DESCRIPTION);
		const arkuse = added.find((t) => t.name === "arkuse_usage");
		expect(arkuse?.description).toBe(ARKUSE_TOOL_DESCRIPTION);
		expect(arkuse?.input.properties.arg.description).toBe(ARKUSE_TOOL_ARG_DESCRIPTION);
	});
	test("mpc_prices description answers cost per request and per month", () => {
		expect(MPC_TOOL_DESCRIPTION).toContain("per request");
		expect(MPC_TOOL_DESCRIPTION).toContain("per month");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--model <regex>");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--minimal");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--medium");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--detail");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--json");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--cc-plan");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--oc-plan");
		expect(MPC_TOOL_ARG_DESCRIPTION).toContain("--usage");
	});
});
