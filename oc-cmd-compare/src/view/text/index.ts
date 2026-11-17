import type { ColorMode } from "#~/cli/options.ts";

let color = true;

/** Resolve a mode; "auto" follows the TTY and NO_COLOR. */
export function setColorMode(mode: ColorMode): void {
	if (mode === "always") color = true;
	else if (mode === "never") color = false;
	else color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

export function setColor(enabled: boolean): void {
	color = enabled;
}

export function paint(code: string, text: string): string {
	return color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export {
	fmtAbility,
	fmtAllowance,
	fmtCount,
	fmtPerDollar,
	fmtPerThousand,
	fmtRate,
	fmtRequests,
	fmtTps,
	fmtUsd,
	planTitle,
	providerName,
	shortProviderName,
} from "./format.ts";
export {
	abilityStyle,
	bestCost,
	bestValue,
	ccRates,
	costStyle,
	enabledStyle,
	freeCc,
	freeOc,
	freeOd,
	ocRates,
	odRates,
	pricingTriple,
	setAbilityRange,
	valueStyle,
} from "./styles.ts";
export {
	bestAbility,
	bestTps,
	cheaperSide,
	entryOf,
	presentSides,
	sideStyle,
	tint,
	tintOrFree,
	winner,
	winnerStyle,
} from "./side.ts";
