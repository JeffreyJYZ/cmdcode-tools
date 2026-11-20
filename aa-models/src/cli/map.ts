import { KNOWN, type Parsed, VALUED } from "./parse.ts";
import {
	CACHE_DEFAULT_MS,
	COLORS,
	cacheDuration,
	type ColorMode,
	date,
	FORMATS,
	type Format,
	int,
	list,
	num,
	oneOf,
	type Options,
	text,
} from "./options.ts";

/** camelCase bag key -> the spelling the user typed. */
function flag(key: string): string {
	return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

/** Reject an undeclared flag instead of letting cac drop it silently. */
function assertKnown(bag: Record<string, unknown>): void {
	const extra = Object.keys(bag).filter((key) => !KNOWN.has(key));
	if (extra.length > 0) {
		throw new Error(`unknown flag "${flag(String(extra[0]))}" — see --help for the full list`);
	}
}

/** A value-taking flag with nothing after it arrives as `true`, never undefined. */
function assertValues(bag: Record<string, unknown>): void {
	const bare = Object.keys(bag).filter((key) => VALUED.has(key) && bag[key] === true);
	if (bare.length > 0) throw new Error(`${flag(String(bare[0]))} expects a value — see --help`);
}

function columns(value: unknown): { columns: string[]; columnsHelp: boolean } {
	if (value === undefined) return { columns: [], columnsHelp: false };
	const parts = text("columns", value)
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	const help = parts.length === 1 && parts[0] === "help";
	return { columns: help ? [] : parts, columnsHelp: help };
}

function commandOf(parsed: Parsed): Parsed["command"] {
	if (parsed.bag.check === true) return "check";
	if (parsed.bag.fields === true) return "fields";
	return parsed.command;
}

/** Reduce the parsed bag to the one Options object every layer reads. */
export function toOptions(parsed: Parsed): Options {
	const bag = parsed.bag;
	assertKnown(bag);
	assertValues(bag);
	if (bag.scored === true && bag.unscored === true) {
		throw new Error("--scored and --unscored are mutually exclusive");
	}
	if (bag.openWeights === true && bag.closedWeights === true) {
		throw new Error("--open-weights and --closed-weights are mutually exclusive");
	}
	const picked = columns(bag.columns);
	const json = bag.json === true;
	const format: Format = json
		? "json"
		: bag.format === undefined
			? "table"
			: oneOf("format", bag.format, FORMATS);
	const command = commandOf(parsed);
	if (command === "model" && (parsed.query === undefined || parsed.query === "")) {
		throw new Error("aa model expects a slug, key or name");
	}
	return {
		command,
		query: parsed.query,
		model: bag.model === undefined ? undefined : text("model", bag.model),
		creators: bag.creator === undefined ? undefined : list(bag.creator),
		where: bag.where === undefined ? [] : asArray(bag.where).map((v) => text("where", v)),
		scored: bag.scored === true,
		unscored: bag.unscored === true,
		minIntel: bag.minIntel === undefined ? undefined : num("min-intel", bag.minIntel),
		maxIntel: bag.maxIntel === undefined ? undefined : num("max-intel", bag.maxIntel),
		minTps: bag.minTps === undefined ? undefined : num("min-tps", bag.minTps),
		maxTps: bag.maxTps === undefined ? undefined : num("max-tps", bag.maxTps),
		minContext: bag.minContext === undefined ? undefined : int("min-context", bag.minContext),
		openWeights: bag.openWeights === true,
		closedWeights: bag.closedWeights === true,
		since: bag.since === undefined ? undefined : date("since", bag.since),
		sort: bag.sort === undefined ? undefined : text("sort", bag.sort),
		asc: bag.asc === true,
		rows: bag.rows === undefined ? undefined : int("rows", bag.rows),
		columns: picked.columns,
		columnsHelp: picked.columnsHelp,
		format,
		json,
		raw: bag.raw === true,
		noApi: bag.api === false,
		aaKey: bag.aaKey === undefined ? undefined : text("aa-key", bag.aaKey),
		refresh: bag.refresh === true,
		cacheMs: bag.cache === undefined ? CACHE_DEFAULT_MS : cacheDuration(bag.cache),
		width: bag.width === undefined ? undefined : int("width", bag.width, 1),
		color: bag.color === undefined ? "auto" : oneOf("color", bag.color, COLORS),
		help: parsed.help,
		version: parsed.version,
	};
}

/** cac collects a repeated option into an array; one use stays a scalar. */
function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [value];
}

export type { ColorMode };
