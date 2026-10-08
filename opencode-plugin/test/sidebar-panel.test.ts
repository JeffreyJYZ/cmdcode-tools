import { describe, expect, test } from "bun:test";
import { RGBA, TextNodeRenderable } from "@opentui/core";
import {
	hostColors,
	legacyColors,
	type PanelColors,
} from "../src/sidebar/panel";

/** Distinct values so a mis-wired token shows up as the wrong colour. */
const c = (r: number) => RGBA.fromValues(r, 0.5, 0.5, 1);

const text = {
	base: c(0.1),
	muted: c(0.2),
	feedback: {
		success: { base: c(0.3) },
		warning: { base: c(0.4) },
		error: { base: c(0.5) },
		info: { base: c(0.6) },
	},
};
const theme = { text };

describe("panel colours", () => {
	test("maps the v2 theme text tokens onto tones", () => {
		const colors = hostColors(theme);
		expect(colors.base).toBe(text.base);
		expect(colors.muted).toBe(text.muted);
		expect(colors.strong).toBe(text.base);
		expect(colors.label).toBe(text.feedback.info.base);
		// No accent hue in this fixture, so headlines share the label hue.
		expect(colors.headline).toBe(text.feedback.info.base);
		expect(colors.ok).toBe(text.feedback.success.base);
		expect(colors.warn).toBe(text.feedback.warning.base);
		expect(colors.crit).toBe(text.feedback.error.base);
	});

	test("the accent hue is read for headlines only, and only in dark mode", () => {
		const purple = c(0.62);
		const accented = { ...theme, hue: { accent: { 200: purple } } };
		const dark = hostColors(accented);
		expect(dark.headline).toBe(purple);
		// Every other tone comes from the text palette, so the peach `primary` /
		// `interactive` scales (the earlier dark orange) cannot reach a row.
		const plain = hostColors(theme);
		for (const tone of [
			"base",
			"muted",
			"strong",
			"ok",
			"warn",
			"crit",
		] as const) {
			expect(dark[tone]).toBe(plain[tone]);
		}
		// Light themes put a peach in the accent slot, so headlines keep the
		// label hue there instead of turning orange.
		expect(hostColors(accented, "light").headline).toBe(
			hostColors(accented, "light").label,
		);
	});

	test("legacy hosts keep their text pair and get literal semantic colours", () => {
		const colors: PanelColors = legacyColors({
			text: c(0.1),
			textMuted: c(0.2),
		});
		expect(colors.base.r).toBeCloseTo(0.1);
		expect(colors.muted.r).toBeCloseTo(0.2);
		for (const tone of ["ok", "warn", "crit", "strong"] as const) {
			expect(colors.label).toBeInstanceOf(RGBA);
			expect(colors.headline).toBeInstanceOf(RGBA);
			expect(colors[tone]).toBeInstanceOf(RGBA);
		}
		expect(colors.ok.r).not.toBe(colors.crit.r);
	});

	test("per-segment colour is real: a row's text nodes keep their own fg", () => {
		// The panel colours a row as two runs (bold label, toned value) through
		// `span`, whose props opentui types as `{}`. This pins that the runtime
		// honours `fg` per node, so the cast in panel.tsx is safe.
		const label = TextNodeRenderable.fromString("Tier: ", { fg: c(0.5) });
		label.add(TextNodeRenderable.fromString("open source", { fg: c(0.9) }));
		const chunks = label.gatherWithInheritedStyle();
		expect(chunks.map((chunk) => chunk.text)).toEqual([
			"Tier: ",
			"open source",
		]);
		const [head, tail] = chunks;
		expect(head?.fg?.r).toBeCloseTo(0.5);
		expect(tail?.fg?.r).toBeCloseTo(0.9);
	});
});
