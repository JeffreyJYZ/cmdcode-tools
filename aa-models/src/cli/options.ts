/** Typed CLI options and the validators every layer runs through. */

export type Format = "table" | "json" | "csv" | "md";
export type ColorMode = "auto" | "always" | "never";
export type Command = "list" | "model" | "fields" | "check";

export const FORMATS: readonly Format[] = ["table", "json", "csv", "md"];
export const COLORS: readonly ColorMode[] = ["auto", "always", "never"];
export const CACHE_DEFAULT_MS = 3_600_000;

/** Units accepted by `--cache`; a bare number is seconds. */
const CACHE_UNITS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

export interface Options {
	command: Command;
	/** Query of `aa model <query>`. */
	query?: string;
	model?: string;
	creators?: string[];
	where: string[];
	scored?: boolean;
	unscored?: boolean;
	minIntel?: number;
	maxIntel?: number;
	minTps?: number;
	maxTps?: number;
	minContext?: number;
	openWeights?: boolean;
	closedWeights?: boolean;
	since?: string;
	sort?: string;
	asc: boolean;
	/** undefined = the default cap in the renderer; 0 = every row. */
	rows?: number;
	columns: string[];
	/** `--columns help` asked for the column list, not a table. */
	columnsHelp: boolean;
	format: Format;
	json: boolean;
	raw: boolean;
	noApi: boolean;
	aaKey?: string;
	refresh: boolean;
	cacheMs: number;
	width?: number;
	color: ColorMode;
	help: boolean;
	version: boolean;
}

export function cacheDuration(value: unknown): number {
	if (value === true || value === undefined) throw new Error(cacheExpects());
	const text = String(value).trim().toLowerCase();
	if (text === "0") return 0;
	const match = /^(\d+)([smhd])$/.exec(text);
	const unit = match?.[2] === undefined ? undefined : CACHE_UNITS[match[2]];
	if (match === null || unit === undefined) throw new Error(cacheExpects());
	return Number(match[1]) * unit;
}

function cacheExpects(): string {
	return "--cache expects a duration: 0, 30s, 15m, 6h or 1d";
}

/** Accepts decimals (scores, speeds) but never a boolean, blank or NaN. */
export function num(name: string, value: unknown): number {
	if (value === true || value === "" || value === undefined) {
		throw new Error(`--${name} expects a number`);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`--${name} expects a number, got "${value}"`);
	return parsed;
}

export function int(name: string, value: unknown, min = 0): number {
	const parsed = num(name, value);
	if (!Number.isInteger(parsed) || parsed < min) {
		throw new Error(`--${name} expects an integer ≥ ${min}, got "${value}"`);
	}
	return parsed;
}

export function text(name: string, value: unknown): string {
	if (value === true || value === "" || value === undefined) {
		throw new Error(`--${name} expects a value`);
	}
	return String(value);
}

export function oneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
	const parsed = text(name, value);
	if (!(allowed as readonly string[]).includes(parsed)) {
		throw new Error(`--${name} must be one of ${allowed.join(", ")} — got "${parsed}"`);
	}
	return parsed as T;
}

export function date(name: string, value: unknown): string {
	const parsed = text(name, value);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
		throw new Error(`--${name} expects a date as YYYY-MM-DD, got "${parsed}"`);
	}
	return parsed;
}

export function list(value: unknown): string[] {
	return text("creator", value)
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}
