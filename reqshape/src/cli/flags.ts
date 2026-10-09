import type { CustomRates } from "#~/market/rates.ts";

/**
 * cac prints --help and --version itself and only sets `run = false`, which is
 * already false for us, so the tool would otherwise carry on and print a report
 * after the help text. This reports that the question is already answered.
 */
export function answeredByCac(flags: Record<string, unknown>): boolean {
	return flags.help === true || flags.version === true;
}

/**
 * mri coerces a numeric-looking value to a number, `""` to `0` and a valueless
 * flag to `true`, so a string option is read through here rather than trusted
 * to arrive as a string.
 */
export function str(value: unknown): string | undefined {
	if (value === undefined || value === null || typeof value === "boolean") {
		return undefined;
	}
	return String(value);
}

export function number(value: unknown, flag: string): number {
	if (typeof value === "boolean") {
		throw new Error(`--${flag} expects a number, got a bare flag`);
	}
	if (value === undefined || value === null) return 0;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(
			`--${flag} expects a number, got ${JSON.stringify(value)}`,
		);
	}
	return parsed;
}

export function optionalNumber(value: unknown, flag: string): number | null {
	if (value === undefined || value === null || value === "") return null;
	return number(value, flag);
}

export function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	flag: string,
): T | undefined {
	if (value === undefined || value === null) return undefined;
	const text = String(value);
	if (!(allowed as readonly string[]).includes(text)) {
		throw new Error(
			`--${flag} expects ${allowed.join(" | ")}, got "${text}"`,
		);
	}
	return text as T;
}

export function sinceOf(value: unknown): number {
	if (value === undefined || value === null || value === "") return 0;
	const parsed = Date.parse(String(value));
	if (Number.isNaN(parsed)) {
		throw new Error(`--since expects a date, got ${JSON.stringify(value)}`);
	}
	return parsed;
}

/** `--keywords ""` and a bare `--keywords` both mean "no keyword list at all". */
export function keywordList(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (value === true || value === 0 || value === "") return [];
	return String(value)
		.split(",")
		.map((word) => word.trim().toLowerCase())
		.filter(Boolean);
}

/** Custom rates only make sense with something to price them against. */
export function customOf(flags: Record<string, unknown>): CustomRates | null {
	// Any custom-model flag counts as "this run is about a custom model". The
	// window caps and label were previously ignored on their own (`customOf`
	// returned null and they vanished); now they demand the rates + budget too.
	const touched =
		flags.in !== undefined ||
		flags.out !== undefined ||
		flags.cacheRead !== undefined ||
		flags.cacheWrite !== undefined ||
		flags.budget !== undefined ||
		flags.fiveHour !== undefined ||
		flags.weekly !== undefined ||
		flags.label !== undefined;
	if (!touched) return null;
	const budget = number(flags.budget, "budget");
	if (budget <= 0) {
		throw new Error("--budget <usd> is required alongside custom rates");
	}
	return {
		label: typeof flags.label === "string" ? flags.label : "custom model",
		input: number(flags.in, "in"),
		output: number(flags.out, "out"),
		cacheRead: optionalNumber(flags.cacheRead, "cache-read"),
		cacheWrite: optionalNumber(flags.cacheWrite, "cache-write"),
		budget,
		// cac camelCases `--five-hour` to `fiveHour`; a name whose dash is
		// followed by a digit (`--cap-5h`) would stay hyphenated and be unreadable.
		cap5h: optionalNumber(flags.fiveHour, "five-hour"),
		capWeek: optionalNumber(flags.weekly, "weekly"),
	};
}
