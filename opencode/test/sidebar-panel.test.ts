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
const accent = c(0.9);
const interactive = c(0.8);
const theme = {
	text,
	hue: { accent: { 400: accent }, interactive: { 400: interactive } },
};

describe("panel colours", () => {
	test("maps the v2 theme tokens onto tones", () => {
		const colors = hostColors(theme);
		expect(colors.base).toBe(text.base);
		expect(colors.muted).toBe(text.muted);
		expect(colors.accent).toBe(accent);
		expect(colors.strong).toBe(text.base);
		expect(colors.data).toBe(interactive);
		expect(colors.ok).toBe(text.feedback.success.base);
		expect(colors.warn).toBe(text.feedback.warning.base);
		expect(colors.crit).toBe(text.feedback.error.base);
	});

	test("falls back when the theme has no accent or interactive hue", () => {
		expect(hostColors({ ...theme, hue: undefined }).accent).toBe(text.base);
		expect(hostColors({ ...theme, hue: undefined }).data).toBe(
			text.feedback.info.base,
		);
		expect(hostColors({ ...theme, hue: { accent: {} } }).accent).toBe(
			text.base,
		);
	});

	test("legacy hosts keep their text pair and get literal semantic colours", () => {
		const colors: PanelColors = legacyColors({
			text: c(0.1),
			textMuted: c(0.2),
		});
		expect(colors.base.r).toBeCloseTo(0.1);
		expect(colors.muted.r).toBeCloseTo(0.2);
		for (const tone of [
			"ok",
			"warn",
			"crit",
			"accent",
			"data",
			"strong",
		] as const) {
			expect(colors[tone]).toBeInstanceOf(RGBA);
		}
		expect(colors.ok.r).not.toBe(colors.crit.r);
	});
});
