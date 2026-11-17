import type { Options } from "#~/cli/options.ts";
import { SETS, TIERS, type Tier } from "#~/constants/cli.ts";
import { OD_BY_TIER, withOd } from "#~/constants/view.ts";

/**
 * The tier the flags asked for. The default is the full set — `--fit` used to
 * be opt-in, but trimming to the terminal is now what plain `mpc` does.
 */
function tierOf(options: Options): Tier {
	const picked = TIERS.filter((tier) => options[tier]);
	if (picked.length > 1) {
		throw new Error(`--${picked.join(" and --")} conflict — pick one column preset`);
	}
	return picked[0] ?? "detail";
}

function namedPreset(options: Options): string[] {
	const named = options.presets[options.preset ?? ""];
	if (!named) throw new Error(`unknown preset "${options.preset}"`);
	return named;
}

/**
 * The columns to render: an exact `--columns` list, a config preset, or a tier.
 * `--od-plan` appends its block to a tier or preset — an exact list stays exact.
 */
export function resolveColumns(options: Options): string[] {
	if (options.columns) return options.columns;
	const tier = tierOf(options);
	const base = options.preset ? namedPreset(options) : SETS[tier];
	return options.odPlan ? withOd(base, OD_BY_TIER[tier]) : base;
}

/** Every tier trims to the terminal width except `--detail` and an exact list. */
export function trimsToWidth(options: Options): boolean {
	return !options.columns && !options.detail && options.fit;
}
