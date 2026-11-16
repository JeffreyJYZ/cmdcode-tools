// Rows of the /cmd-settings dialog, kept free of JSX so both hosts and the
// tests can read them as plain data (the panel does the same for sidebar rows).
//
// Every row is a cycle: `values()` is the label list in display order, `value()`
// is what is stored now, `set()` writes it back to the prefs file. Labels are
// the only strings the dialog shows, so the stored file stays typed and the
// panel keeps its own parsing rules.
import {
	COST_MODES,
	COST_REFRESH_CHOICES,
	OD_PLANS,
	POLL_CHOICES,
	type CostMode,
	type OcPlan,
	type OdPlan,
} from "../constants/sidebar";
import type { Prefs } from "./prefs";

export interface SettingRow {
	readonly title: string;
	readonly values: () => readonly string[];
	readonly value: () => string;
	readonly set: (label: string) => void;
	/** A row that only applies while another setting allows it. */
	readonly hidden?: () => boolean;
	readonly describe?: (label: string) => string;
}

/** `5000` reads `5s`, `300000` reads `5m`. */
export function durationLabel(ms: number): string {
	return ms >= 60_000 ? `${ms / 60_000}m` : `${ms / 1_000}s`;
}

const onOff = (value: boolean): string => (value ? "on" : "off");

/**
 * The setting list, in the order the dialog shows it. `prefs` is a getter, not
 * a snapshot: the dialog re-reads after each change so a hidden row appears the
 * moment the cost mode leaves `off`.
 */
export function settingRows(
	prefs: () => Prefs,
	save: (patch: Partial<Prefs>) => void,
): SettingRow[] {
	return [
		{
			title: "Colours",
			values: () => ["off", "on"],
			value: () => onOff(prefs().colors),
			set: (label) => save({ colors: label === "on" }),
			describe: (label) =>
				label === "on"
					? "Tint status rows green/amber/red; plain text keeps bold and dim only."
					: "Plain text only. Bold marks headlines, dim marks labels.",
		},
		{
			title: "OpenCode plan",
			values: () => ["go", "go-plus"],
			value: () => prefs().ocPlan,
			set: (label) => save({ ocPlan: label as OcPlan }),
			describe: (label) =>
				label === "go-plus"
					? "Per-model monthly limits are the Go Plus ones."
					: "Per-model monthly limits are the standard Go ones.",
		},
		{
			title: "OpenDesign panel",
			values: () => ["off", "on"],
			value: () => onOff(prefs().od),
			set: (label) => save({ od: label === "on" }),
			describe: (label) =>
				label === "on"
					? "The OpenDesign section, from `oduse`: plan caps, credits per window and per model, and the app's wallet balance. Credits are an estimate — the app's store records no cache tokens."
					: "No OpenDesign section and no `oduse` spawn, so an OpenDesign session gets no panel block.",
		},
		{
			title: "OpenDesign plan",
			values: () => [...OD_PLANS],
			value: () => prefs().odPlan,
			set: (label) => {
				if ((OD_PLANS as readonly string[]).includes(label)) {
					save({ odPlan: label as OdPlan });
				}
			},
			hidden: () => !prefs().od,
			describe: (label) =>
				label === "go"
					? "The caps that section measures against. Only Go publishes a 5-hour one."
					: "The caps that section measures against. This plan publishes no 5-hour cap.",
		},
		{
			title: "Refresh",
			values: () => POLL_CHOICES.map(durationLabel),
			value: () => durationLabel(prefs().pollMs),
			set: (label) => {
				const index = POLL_CHOICES.map(durationLabel).indexOf(label);
				if (index !== -1) save({ pollMs: POLL_CHOICES[index] });
			},
			describe: (label) =>
				`Poll the account API every ${label}. Shorter is fresher and costs one CLI spawn per tick.`,
		},
		{
			title: "Local cost rows",
			values: () => [...COST_MODES],
			value: () => prefs().cost,
			set: (candidate) => {
				if ((COST_MODES as readonly string[]).includes(candidate)) {
					save({ cost: candidate as CostMode });
				}
			},
			describe: (candidate) =>
				candidate === "off"
					? "No database reads at all: the panel shows account percentages only."
					: "Reads this machine's message store for a $ figure. The scan takes 0.5-1.9s on a large store, so it runs on its own slower interval.",
		},
		{
			title: "Cost refresh",
			values: () => COST_REFRESH_CHOICES.map(durationLabel),
			value: () => durationLabel(prefs().costMs),
			set: (label) => {
				const index = COST_REFRESH_CHOICES.map(durationLabel).indexOf(label);
				if (index !== -1) save({ costMs: COST_REFRESH_CHOICES[index] });
			},
			hidden: () => prefs().cost === "off",
			describe: (label) => `Re-scan the message store for cost every ${label}.`,
		},
	];
}
