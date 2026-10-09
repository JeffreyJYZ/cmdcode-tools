/** @jsxImportSource @opentui/solid */
// Renders the panel through the real @opentui/solid reconciler and asserts the
// colours in the produced frame. This is the guard that was missing when
// `<span fg>` (silently ignored) replaced `<span style={{ fg }}>`.
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { hostColors, mono, Panel } from "../src/sidebar/panel";
import { type SidebarRow, separator } from "../src/sidebar/rows";
import { parseZenJson, zenRows } from "../src/sidebar/zen";

const hex = (c: RGBA) =>
	`#${[c.r, c.g, c.b]
		.map((v) =>
			Math.round(v * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

const theme = {
	text: {
		base: RGBA.fromValues(1, 1, 1, 1),
		muted: RGBA.fromValues(0.5, 0.5, 0.5, 1),
		feedback: {
			success: { base: RGBA.fromValues(0.5, 0.85, 0.56, 1) },
			warning: { base: RGBA.fromValues(0.96, 0.65, 0.26, 1) },
			error: { base: RGBA.fromValues(0.88, 0.42, 0.46, 1) },
			info: { base: RGBA.fromValues(0.34, 0.71, 0.76, 1) },
		},
	},
	// The accent hue headlines take in dark mode (purple in the default theme).
	hue: { accent: { 200: RGBA.fromValues(0.62, 0.49, 0.85, 1) } },
};
const colors = hostColors(theme);

const rows: SidebarRow[] = [
	["Plan", "GOAT · $70/mo credits", "base", true],
	["Monthly", "$57.40 / $70 (82%)", "warn"],
	["", "99% elapsed · resets 3h 44m", "muted"],
	separator(),
	["Model", "DeepSeek V4.1 Flash", "strong", true],
	["Tier", "open source", "data"],
];

describe("rendered panel", () => {
	test("labels and values carry different colours", async () => {
		const setup = await testRender(
			() => (
				<Panel
					title={() => "Command Code"}
					rows={() => rows}
					colors={() => colors}
				/>
			),
			{ width: 42, height: 12 },
		);
		await setup.renderOnce();
		const frame = setup.captureSpans();
		const spans = frame.lines.flatMap((line) => line.spans);
		const find = (text: string) =>
			spans.find((span) => span.text.includes(text));

		// The point of the whole exercise: no row may collapse to one colour,
		// and labels wear their own hue rather than the value's.
		expect(hex(find("Tier: ")?.fg as RGBA)).toBe(hex(colors.label));
		// The two headline rows are whole-line: label and value share one shade.
		expect(hex(find("Plan: ")?.fg as RGBA)).toBe(hex(colors.headline));
		expect(hex(find("GOAT · $70/mo credits")?.fg as RGBA)).toBe(
			hex(colors.headline),
		);
		expect(hex(find("Model: ")?.fg as RGBA)).toBe(hex(colors.headline));
		expect(hex(find("DeepSeek V4.1 Flash")?.fg as RGBA)).toBe(
			hex(colors.headline),
		);
		expect(hex(colors.headline)).not.toBe(hex(colors.label));
		expect(hex(find("open source")?.fg as RGBA)).toBe(hex(colors.base));
		expect(hex(find("$57.40 / $70 (82%)")?.fg as RGBA)).toBe(
			hex(colors.warn),
		);
		expect(hex(colors.label)).not.toBe(hex(colors.base));

		// Labels are bold (attributes set), values are not.
		expect(find("Tier: ")?.attributes).not.toBe(0);
		expect(find("open source")?.attributes).toBe(0);

		// Continuations and the rule stay dim.
		expect(hex(find("99% elapsed")?.fg as RGBA)).toBe(hex(colors.muted));
		expect(hex(find("───")?.fg as RGBA)).toBe(hex(colors.muted));
	});

	test("a Go Plus free model renders `Go Plus` and `∞`, not `$0/mo`", async () => {
		// The plan setting reaches the panel as `Go Plus` on the Plan row and the
		// free model's allowance as `∞` (never a money figure for a zero budget).
		const zen = zenRows(
			parseZenJson(
				JSON.stringify({
					totals: {
						fiveHour: { requests: 0, cost: 0 },
						weekly: { requests: 0, cost: 0 },
						month: { requests: 3, cost: 0 },
					},
					models: [
						{
							id: "step5preview",
							provider: "opencode-go",
							limit: null,
							fiveHour: { requests: 0, cost: 0 },
							weekly: { requests: 0, cost: 0 },
							month: { requests: 3, cost: 0 },
						},
					],
				}),
			),
			{
				key: "step5preview",
				name: "Step 5 Preview",
				oc: {
					provider: "oc-go",
					plan: "Go Plus",
					allowance: 0,
					free: true,
					rates: { input: 0, output: 0, cacheRead: 0 },
				},
			},
		);
		const setup = await testRender(
			() => (
				<Panel
					title={() => "OpenCode Go"}
					rows={() => zen}
					colors={() => mono(colors)}
				/>
			),
			{ width: 42, height: 16 },
		);
		await setup.renderOnce();
		const text = setup
			.captureSpans()
			.lines.flatMap((line) => line.spans.map((span) => span.text))
			.join("");
		expect(text).toContain("Go Plus · limits per model");
		expect(text).toContain("∞");
		expect(text).not.toContain("$0/mo");
	});

	test("colours off: nothing chromatic reaches the frame", async () => {
		// The default is off (see sidebar/prefs.ts), so this is the frame most
		// users see: plain text and dim only, no cyan, no amber, no headline hue.
		const setup = await testRender(
			() => (
				<Panel
					title={() => "Command Code"}
					rows={() => rows}
					colors={() => mono(colors)}
				/>
			),
			{ width: 42, height: 12 },
		);
		await setup.renderOnce();
		const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
		const achromatic = new Set([hex(colors.base), hex(colors.muted)]);
		expect(spans.length).toBeGreaterThan(5);
		for (const span of spans) {
			expect(achromatic.has(hex(span.fg))).toBe(true);
		}
	});
});
