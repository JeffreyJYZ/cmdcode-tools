/** @jsxImportSource @opentui/solid */
// The panel's empty first paint. Every section starts with no rows — `useRows`
// seeds from the last snapshot, and the first mount of a session has none (the
// OpenDesign block is that case exactly: `oduse` only runs for an OpenDesign
// session, so nothing has ever been seeded). opentui's reconciler throws
// `Orphan text error: "" must have a <text> as a parent` for a false `<Show>`
// with no fallback, and the host's `PluginBoundary` turns that throw into a
// "crashed in slot sidebar.content" toast and no section at all.
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { hostColors, Panel } from "../src/sidebar/panel";
import type { SidebarRow } from "../src/sidebar/rows";

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
};

const empty: SidebarRow[] = [];

describe("an empty panel", () => {
	test("mounts without throwing, and paints no title", async () => {
		// The mount itself is the assertion: before the fallback existed this
		// threw out of the reconciler, which is what blanked the section.
		const setup = await testRender(
			() => (
				<Panel
					title={() => "OpenDesign"}
					rows={() => empty}
					colors={() => hostColors(theme)}
				/>
			),
			{ width: 42, height: 8 },
		);
		await setup.renderOnce();
		const text = setup
			.captureSpans()
			.lines.flatMap((line) => line.spans.map((span) => span.text))
			.join("")
			.trim();
		expect(text).toBe("");
	});

	test("a single-row panel still paints the title", async () => {
		// The guard against over-correcting: the empty fallback must not swallow
		// the section once rows exist.
		const one: SidebarRow[] = [["Plan", "go plan · estimate", "base", true]];
		const setup = await testRender(
			() => (
				<Panel
					title={() => "OpenDesign"}
					rows={() => one}
					colors={() => hostColors(theme)}
				/>
			),
			{ width: 42, height: 8 },
		);
		await setup.renderOnce();
		const text = setup
			.captureSpans()
			.lines.flatMap((line) => line.spans.map((span) => span.text))
			.join("");
		expect(text).toContain("OpenDesign");
		expect(text).toContain("go plan · estimate");
	});
});
