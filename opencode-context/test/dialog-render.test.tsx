/** @jsxImportSource @opentui/solid */
// Renders the dialog through the real @opentui/solid reconciler and asserts the
// polish that fixed the "squished" frame: a full-width background bar, spaced
// sections, a column header, a thinner tick for tool children, one-decimal
// percents, a capped tool list, and the esc hint.
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { Breakdown, Bucket } from "../src/breakdown";
import {
	CHILD_INDENT,
	CHILD_TICK,
	MAX_CHILDREN,
	TICK,
} from "../src/constants/dialog";
import { BreakdownDialog } from "../src/dialog";

const colors = {
	label: RGBA.fromValues(0.5, 0.5, 0.5, 1),
	value: RGBA.fromValues(0.95, 0.95, 0.95, 1),
	muted: RGBA.fromValues(0.5, 0.5, 0.5, 1),
};

const child = (label: string, bytes: number, tokens: number): Bucket => ({
	key: `o:${label}`,
	label,
	tone: "outputs",
	bytes,
	tokens,
	children: [],
});

const breakdown: Breakdown = {
	measuredTokens: 200_000,
	limit: 1_000_000,
	percent: 20,
	totalBytes: 100_000,
	totalTokens: 25_000,
	buckets: [
		{
			key: "outputs",
			label: "Tool Outputs",
			tone: "outputs",
			bytes: 60_000,
			tokens: 15_000,
			children: [child("read", 59_000, 14_750), child("write", 1_000, 250)],
		},
		{
			key: "thinking",
			label: "Thinking Blocks",
			tone: "thinking",
			bytes: 40_000,
			tokens: 10_000,
			children: [],
		},
		{
			key: "other",
			label: "Other",
			tone: "other",
			bytes: 1,
			tokens: 1,
			children: [],
		},
	],
};

async function render(breakdown: Breakdown, width = 60, height = 16) {
	const setup = await testRender(
		() => <BreakdownDialog breakdown={breakdown} colors={colors} />,
		{ width, height },
	);
	await setup.renderOnce();
	return setup;
}

const hex = (c: RGBA) =>
	`#${[c.r, c.g, c.b]
		.map((v) =>
			Math.round(v * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

describe("rendered dialog", () => {
	test("the bar is a full-width run of distinct background colours", async () => {
		const setup = await render(breakdown);
		const bar = setup
			.captureSpans()
			.lines.find(
				(line) =>
					new Set(
						line.spans.map((s) => hex(s.bg)).filter((bg) => bg !== "#000000"),
					).size >= 2,
			);
		expect(bar).toBeDefined();
		const painted = (bar?.spans ?? []).filter((s) => hex(s.bg) !== "#000000");
		// One span per segment, so measure cells (width), not span count:
		// the bar must span the dialog, not a fixed-width stub.
		const cells = painted.reduce((total, s) => total + s.width, 0);
		expect(cells).toBeGreaterThan(40);
		expect(new Set(painted.map((s) => hex(s.bg))).size).toBeGreaterThanOrEqual(
			2,
		);
	});

	test("rows, columns, thinner ticks and one-decimal percents", async () => {
		const setup = await render(breakdown);
		// Labels render a non-breaking space (see dialog.tsx); normalise to test.
		const text = setup.captureCharFrame().replace(/\u00a0/g, " ");
		expect(text).toContain(`${TICK}Tool Outputs`);
		expect(text).toContain(`${CHILD_TICK}${CHILD_INDENT}read`);
		// The row after a bucket with children must keep its space intact
		// (regression: it rendered as "ThinkingoBlocks").
		expect(text).toContain(`${TICK}Thinking Blocks`);
		// A column header makes the bytes/tokens columns unambiguous.
		expect(text).toContain("tokens");
		expect(text).toContain("size");
		expect(text).toContain("share");
		expect(text).toContain("20% used");
		expect(text).toContain("esc close");
		// 1 byte out of 100 KB is ~0.001%: it must read "0.0%", never "0%".
		expect(text).toContain("0.0%");
		expect(text).not.toMatch(/\s0%(?!\.)/);
	});

	test("a long tool list rolls its tail into one row", async () => {
		const toolCount = 12;
		const many: Breakdown = {
			...breakdown,
			buckets: [
				{
					key: "outputs",
					label: "Tool Outputs",
					tone: "outputs",
					bytes: 1200,
					tokens: 300,
					children: Array.from({ length: toolCount }, (_, i) =>
						child(`tool${i}`, 100, 25),
					),
				},
			],
		};
		const setup = await render(many, 60, 24);
		const text = setup.captureCharFrame().replace(/\u00a0/g, " ");
		expect(text).toContain("tool0");
		expect(text).toContain(`+${toolCount - (MAX_CHILDREN - 1)} more tools`);
		expect(text).not.toContain(`tool${toolCount - 1}`);
	});
});
