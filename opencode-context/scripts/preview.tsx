/** @jsxImportSource @opentui/solid */
// Headless preview of the /context dialog. Prints the exact frame the TUI
// paints, so layout changes can be iterated without a live opencode.
//   bun run scripts/preview.tsx [width]
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { Breakdown } from "../src/breakdown";
import { BreakdownDialog } from "../src/dialog";

const sample: Breakdown = {
	measuredTokens: 209_400,
	limit: 1_000_000,
	percent: 21,
	totalBytes: 880_000,
	totalTokens: 220_000,
	buckets: [
		{
			key: "outputs",
			label: "Tool Outputs",
			tone: "outputs",
			bytes: 358_000,
			tokens: 89_000,
			children: [
				{
					key: "o:read",
					label: "read",
					tone: "outputs",
					bytes: 259_900,
					tokens: 65_000,
					children: [],
				},
				{
					key: "o:shell",
					label: "shell",
					tone: "outputs",
					bytes: 95_200,
					tokens: 23_800,
					children: [],
				},
				{
					key: "o:write",
					label: "write",
					tone: "outputs",
					bytes: 1_200,
					tokens: 300,
					children: [],
				},
				{
					key: "o:execute",
					label: "execute",
					tone: "outputs",
					bytes: 807,
					tokens: 202,
					children: [],
				},
				{
					key: "o:edit",
					label: "edit",
					tone: "outputs",
					bytes: 667,
					tokens: 167,
					children: [],
				},
				{
					key: "o:question",
					label: "question",
					tone: "outputs",
					bytes: 239,
					tokens: 60,
					children: [],
				},
			],
		},
		{
			key: "thinking",
			label: "Thinking Blocks",
			tone: "thinking",
			bytes: 239_500,
			tokens: 59_900,
			children: [],
		},
		{
			key: "inputs",
			label: "Tool Inputs",
			tone: "inputs",
			bytes: 84_700,
			tokens: 21_200,
			children: [],
		},
		{
			key: "checkpoint",
			label: "Conversation Checkpoint",
			tone: "other",
			bytes: 76_700,
			tokens: 19_200,
			children: [],
		},
		{
			key: "system",
			label: "System Prompt",
			tone: "system",
			bytes: 52_100,
			tokens: 13_000,
			children: [],
		},
		{
			key: "user",
			label: "User Messages",
			tone: "user",
			bytes: 48_200,
			tokens: 12_100,
			children: [],
		},
		{
			key: "toolDefs",
			label: "Tool Definitions",
			tone: "toolDefs",
			bytes: 11_800,
			tokens: 3_000,
			children: [],
		},
		{
			key: "assistant",
			label: "Assistant Prose",
			tone: "assistant",
			bytes: 8_900,
			tokens: 2_200,
			children: [],
		},
		{
			key: "other",
			label: "Other",
			tone: "other",
			bytes: 51,
			tokens: 13,
			children: [],
		},
	],
};

const width = Number(process.argv[2] ?? 80);
// `host` mimics the dialog host: the plugin's JSX is a child of a fixed-width
// box (dialogWidth("large") === 88, paddingTop 1, no horizontal padding).
const host = process.argv.includes("host");
const content = () => (
	<BreakdownDialog
		breakdown={sample}
		colors={{
			label: RGBA.fromValues(0.5, 0.5, 0.5, 1),
			value: RGBA.fromValues(0.95, 0.95, 0.95, 1),
			muted: RGBA.fromValues(0.5, 0.5, 0.5, 1),
		}}
	/>
);
const setup = await testRender(
	host
		? () => (
				<box width={88} paddingTop={1} flexDirection="column">
					{content()}
				</box>
			)
		: content,
	{ width, height: 24 },
);
await setup.renderOnce();
await setup.waitForVisualIdle();
console.log(setup.captureCharFrame());
if (process.argv.includes("spans")) {
	const hex = (c: RGBA) =>
		`#${[c.r, c.g, c.b]
			.map((v) =>
				Math.round(v * 255)
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")}`;
	const frame = setup.captureSpans();
	for (const [index, line] of frame.lines.entries()) {
		const bgs = [...new Set(line.spans.map((s) => hex(s.bg)))];
		const text = line.spans
			.map((s) => s.text)
			.join("")
			.trimEnd()
			.slice(0, 24);
		console.log(
			`[line ${String(index).padStart(2)}] bgs=${bgs.join(",")} | ${text}`,
		);
	}
	// The bar: does its painted run cover the full frame, or leave a seam?
	const painted = (line: (typeof frame.lines)[number]) =>
		line.spans.filter((s) => hex(s.bg) !== "#000000");
	const bar = frame.lines.find(
		(line) => new Set(painted(line).map((s) => hex(s.bg))).size >= 2,
	);
	if (bar) {
		// Walk the line and find gaps *between* painted runs (a seam), not just
		// how many cells are painted.
		const runs: Array<[number, number]> = [];
		let offset = 0;
		for (const s of bar.spans) {
			if (hex(s.bg) !== "#000000") {
				const last = runs[runs.length - 1];
				if (last && last[1] === offset) last[1] = offset + s.width;
				else runs.push([offset, offset + s.width]);
			}
			offset += s.width;
		}
		const gaps = runs
			.slice(1)
			.map((run, i) => run[0] - (runs[i]?.[1] ?? 0))
			.filter((gap) => gap > 0);
		const cells = runs.reduce((n, [a, b]) => n + (b - a), 0);
		console.log(
			`[bar] cells=${cells} cols=${frame.cols} runs=${JSON.stringify(runs)} gaps=${JSON.stringify(gaps)}`,
		);
	}
}
process.exit(0);
