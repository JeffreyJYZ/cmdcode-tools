import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
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
		expect(colors.data).toBe(text.feedback.info.base);
		expect(colors.ok).toBe(text.feedback.success.base);
		expect(colors.warn).toBe(text.feedback.warning.base);
		expect(colors.crit).toBe(text.feedback.error.base);
	});

	test("takes no colour from the theme's hue scales", () => {
		// The widget hues derive from `primary`, a dull peach in the default
		// theme, which is what painted rows dark orange. Passing a theme with
		// hues must not change a single tone.
		const withHues = hostColors({
			...theme,
			hue: { accent: { 400: c(0.99) }, interactive: { 400: c(0.98) } },
		} as Parameters<typeof hostColors>[0]);
		expect(withHues).toEqual(hostColors(theme));
	});

	test("legacy hosts keep their text pair and get literal semantic colours", () => {
		const colors: PanelColors = legacyColors({
			text: c(0.1),
			textMuted: c(0.2),
		});
		expect(colors.base.r).toBeCloseTo(0.1);
		expect(colors.muted.r).toBeCloseTo(0.2);
		for (const tone of ["ok", "warn", "crit", "data", "strong"] as const) {
			expect(colors[tone]).toBeInstanceOf(RGBA);
		}
		expect(colors.ok.r).not.toBe(colors.crit.r);
	});
});
