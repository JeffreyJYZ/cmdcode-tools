import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCapture } from "../src/capture";
import { collectBreakdown } from "../src/collect";

// Hermetic: a fake opencode TUI context plus a temp capture cache; no network,
// no real $HOME, no spawning.
const originalXdg = process.env.XDG_CACHE_HOME;
const root = mkdtempSync(join(tmpdir(), "oc-context-collect-"));
process.env.XDG_CACHE_HOME = root;

afterAll(() => {
	if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
	else process.env.XDG_CACHE_HOME = originalXdg;
	rmSync(root, { recursive: true, force: true });
});

type CtxArg = Parameters<typeof collectBreakdown>[0];

const SESSION = {
	model: { providerID: "command-code-openai", id: "deepseek-v4.1-flash" },
	agent: "build",
	location: "loc",
};

interface FakeCtxOptions {
	messages?: readonly unknown[];
	contextRejects?: boolean;
	models?: readonly unknown[];
	agents?: readonly unknown[];
}

function fakeCtx(options: FakeCtxOptions = {}): CtxArg {
	const messages = options.messages ?? [];
	const list = () => options.messages ?? [];
	return {
		client: {
			session: {
				context: async () => {
					if (options.contextRejects) throw new Error("no context");
					return messages;
				},
			},
		},
		data: {
			session: { get: () => SESSION, message: { list } },
			location: {
				model: { list: () => options.models ?? [] },
				agent: { list: () => options.agents ?? [] },
			},
		},
	} as unknown as CtxArg;
}

const assistantTurn = (text: string) => ({
	type: "assistant",
	content: [{ type: "text", text }],
	tokens: { input: 1000, output: 200 },
});

describe("collectBreakdown", () => {
	test("reads session.context, the capture sizes and the model limit", async () => {
		await writeCapture("ses_ctx", {
			systemBytes: 1000,
			toolDefsBytes: 400,
			at: 1,
		});
		const breakdown = await collectBreakdown(
			fakeCtx({
				messages: [{ type: "user", text: "hello there" }, assistantTurn("the answer")],
				models: [
					{
						providerID: "command-code-openai",
						id: "deepseek-v4.1-flash",
						limit: { context: 200_000 },
					},
				],
			}),
			"ses_ctx",
		);

		expect(breakdown.measuredTokens).toBe(1200);
		expect(breakdown.limit).toBe(200_000);
		expect(breakdown.percent).toBe(1);
		const system = breakdown.buckets.find((b) => b.key === "system");
		const toolDefs = breakdown.buckets.find((b) => b.key === "toolDefs");
		expect(system?.bytes).toBe(1000);
		expect(toolDefs?.bytes).toBe(400);
	});

	test("falls back to the raw message list when session.context rejects", async () => {
		const breakdown = await collectBreakdown(
			fakeCtx({
				contextRejects: true,
				messages: [assistantTurn("only in the raw list")],
			}),
			"ses_fallback",
		);
		expect(breakdown.measuredTokens).toBe(1200);
	});

	test("without a capture, system falls back to the agent and tool defs hide", async () => {
		const breakdown = await collectBreakdown(
			fakeCtx({
				messages: [{ type: "user", text: "hi" }],
				agents: [{ id: "build", system: "abc" }],
			}),
			"ses_no_capture",
		);
		const system = breakdown.buckets.find((b) => b.key === "system");
		expect(system?.bytes).toBe(3);
		expect(breakdown.buckets.some((b) => b.key === "toolDefs")).toBe(false);
	});

	test("no matching model leaves the limit and percent undefined", async () => {
		const breakdown = await collectBreakdown(
			fakeCtx({ messages: [assistantTurn("x")], models: [] }),
			"ses_no_model",
		);
		expect(breakdown.limit).toBeUndefined();
		expect(breakdown.percent).toBeUndefined();
	});
});
