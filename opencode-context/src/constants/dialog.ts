/** Fixed data for the /context dialog: the bar palette (so it reads the same on
 * any theme), the numeric column widths, the row glyphs, and the child cap. */
import { RGBA } from "@opentui/core";
import type { Tone } from "../breakdown";

export const PALETTE: Record<Tone, RGBA> = {
	thinking: RGBA.fromValues(0.93, 0.69, 0.31, 1),
	outputs: RGBA.fromValues(0.87, 0.45, 0.5, 1),
	system: RGBA.fromValues(0.63, 0.67, 0.73, 1),
	inputs: RGBA.fromValues(0.4, 0.72, 0.75, 1),
	user: RGBA.fromValues(0.82, 0.67, 0.42, 1),
	assistant: RGBA.fromValues(0.67, 0.56, 0.9, 1),
	toolDefs: RGBA.fromValues(0.5, 0.62, 0.9, 1),
	other: RGBA.fromValues(0.55, 0.58, 0.62, 1),
};

/** Distinct hues for tool children, so sub-tools read apart (a lighter step of
 * the parent hue does not — see AGENTS.md). */
export const CHILD_PALETTE: readonly RGBA[] = [
	RGBA.fromValues(0.87, 0.45, 0.5, 1),
	RGBA.fromValues(0.93, 0.69, 0.31, 1),
	RGBA.fromValues(0.47, 0.75, 0.6, 1),
	RGBA.fromValues(0.5, 0.62, 0.9, 1),
	RGBA.fromValues(0.67, 0.56, 0.9, 1),
	RGBA.fromValues(0.4, 0.72, 0.75, 1),
	RGBA.fromValues(0.82, 0.67, 0.42, 1),
	RGBA.fromValues(0.78, 0.55, 0.71, 1),
];

export const TOKENS_WIDTH = 7;
export const SIZE_WIDTH = 8;
export const PCT_WIDTH = 6;
export const TICK = "▌ ";
export const CHILD_TICK = "▏ ";
export const CHILD_INDENT = "  ";
/** Keep the dialog from growing past the tool count that fits, oldest shown. */
export const MAX_CHILDREN = 8;
