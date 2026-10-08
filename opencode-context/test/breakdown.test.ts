import { describe, expect, test } from "bun:test";
import {
	computeBreakdown,
	measuredTokensOf,
	renderMarkdown,
} from "../src/breakdown";

const assistant = (content: unknown[], tokens?: unknown) => ({
	type: "assistant",
	content,
	tokens,
});

describe("computeBreakdown", () => {
	test("classifies user, assistant, thinking and tool parts", () => {
		const breakdown = computeBreakdown({
			messages: [
				{ type: "user", text: "hello there" },
				assistant([
					{ type: "reasoning", text: "thinking hard" },
					{ type: "text", text: "the answer" },
					{
						type: "tool",
						name: "terminal",
						state: {
							status: "completed",
							input: { cmd: "ls" },
							content: [{ type: "text", text: "out" }],
						},
					},
				]),
			],
		});
		const byKey = Object.fromEntries(breakdown.buckets.map((b) => [b.key, b]));
		expect(byKey.user?.bytes).toBe(11);
		expect(byKey.assistant?.bytes).toBe(10);
		expect(byKey.thinking?.bytes).toBe(13);
		expect(byKey.outputs?.children[0]?.label).toBe("terminal");
		expect(byKey.inputs?.bytes).toBeGreaterThan(0);
	});

	test("tool outputs split per tool and sort largest first", () => {
		const long = "x".repeat(500);
		const breakdown = computeBreakdown({
			messages: [
				assistant([
					{
						type: "tool",
						name: "small",
						state: {
							status: "completed",
							input: {},
							content: [{ type: "text", text: "s" }],
						},
					},
					{
						type: "tool",
						name: "big",
						state: {
							status: "completed",
							input: {},
							content: [{ type: "text", text: long }],
						},
					},
				]),
			],
		});
		const children =
			breakdown.buckets.find((b) => b.key === "outputs")?.children ?? [];
		expect(children.map((c) => c.label)).toEqual(["big", "small"]);
	});

	test("captured system prompt and tool definitions carry their byte sizes", () => {
		const breakdown = computeBreakdown({
			messages: [],
			systemBytes: 4096,
			toolDefsBytes: 2048,
		});
		const system = breakdown.buckets.find((b) => b.key === "system");
		const toolDefs = breakdown.buckets.find((b) => b.key === "toolDefs");
		expect(system?.bytes).toBe(4096);
		expect(toolDefs?.bytes).toBe(2048);
	});

	test("tool definitions are hidden without a capture, system falls back", () => {
		const breakdown = computeBreakdown({
			messages: [],
			fallbackSystemBytes: 100,
		});
		expect(breakdown.buckets.find((b) => b.key === "toolDefs")).toBeUndefined();
		expect(breakdown.buckets.find((b) => b.key === "system")?.bytes).toBe(100);
	});

	test("buckets sort largest first and totals add up", () => {
		const breakdown = computeBreakdown({
			messages: [
				{ type: "user", text: "x".repeat(100) },
				assistant([{ type: "text", text: "y".repeat(10) }]),
			],
		});
		expect(breakdown.buckets[0]?.key).toBe("user");
		const sum = breakdown.buckets.reduce((n, b) => n + b.bytes, 0);
		expect(breakdown.totalBytes).toBe(sum);
	});

	test("percent comes from measured tokens over the limit", () => {
		const breakdown = computeBreakdown({
			messages: [
				assistant([{ type: "text", text: "hi" }], { input: 50, output: 50 }),
			],
			limit: 1000,
		});
		expect(breakdown.measuredTokens).toBe(100);
		expect(breakdown.percent).toBe(10);
	});
});

describe("measuredTokensOf", () => {
	test("reads the newest assistant turn's total usage", () => {
		const messages = [
			assistant([{ type: "text", text: "old" }], { input: 1 }),
			{ type: "user", text: "q" },
			assistant([{ type: "text", text: "new" }], {
				input: 100,
				output: 20,
				reasoning: 5,
				cache: { read: 30, write: 10 },
			}),
		];
		expect(measuredTokensOf(messages)).toBe(165);
	});

	test("undefined when no turn carries usage", () => {
		expect(measuredTokensOf([{ type: "user", text: "q" }])).toBeUndefined();
	});
});

describe("renderMarkdown", () => {
	test("lists every bucket and tool child", () => {
		const markdown = renderMarkdown(
			computeBreakdown({
				messages: [
					assistant([
						{
							type: "tool",
							name: "grep",
							state: {
								status: "completed",
								input: {},
								content: [{ type: "text", text: "hit" }],
							},
						},
					]),
				],
				systemBytes: 100,
			}),
		);
		expect(markdown).toContain("## Context Window");
		expect(markdown).toContain("Tool Outputs");
		expect(markdown).toContain("└ grep");
		expect(markdown).toContain("System Prompt");
	});
});
