import type { Model } from "#~/model.ts";
import {
	EMPTY,
	fmtCount,
	fmtDate,
	fmtOpen,
	fmtPrice,
	fmtScore,
	fmtSeconds,
	fmtTps,
} from "#~/view/format.ts";

export interface Column {
	id: string;
	header: string;
	align: "left" | "right";
	/** Widest this column may grow, in characters. */
	gain: number;
	/** Lower is dropped first when trimming; absent means never dropped. */
	drop?: number;
	value(model: Model): string;
	/** One line for `--columns help`. */
	desc: string;
	/** A favourable reading, painted green. */
	good?(model: Model): boolean;
}

type Spec = [
	string,
	string,
	"left" | "right",
	number,
	number,
	(model: Model) => string,
	string,
	((model: Model) => boolean)?,
];

const priceOf = (m: Model, key: "input" | "output" | "blended") =>
	fmtPrice(m.price === null ? null : m.price[key]);
const freeAt = (m: Model, key: "input" | "output") => m.price !== null && m.price[key] === 0;
const goodIntel = (m: Model) => m.intelligenceIndex !== null && m.intelligenceIndex >= 50;
const goodTps = (m: Model) => m.outputSpeed !== null && m.outputSpeed >= 100;
const goodLatency = (m: Model) => m.latency !== null && m.latency <= 1;

/** Column set as data: a zero drop priority means the column is never dropped. */
const SPECS: Spec[] = [
	["name", "NAME", "left", 30, 0, (m) => m.name, "model name as AA prints it"],
	["slug", "SLUG", "left", 30, 3, (m) => m.slug, "AA's own slug (the identity)"],
	["short", "SHORT", "left", 14, 5, (m) => m.shortName ?? EMPTY, "AA's short display name"],
	["creator", "CREATOR", "left", 16, 2, (m) => m.creator ?? EMPTY, "model creator"],
	[
		"intel",
		"INTEL",
		"right",
		6,
		0,
		(m) => fmtScore(m.intelligenceIndex),
		"Intelligence Index",
		goodIntel,
	],
	["tps", "T/PS", "right", 7, 0, (m) => fmtTps(m.outputSpeed), "output tokens/second", goodTps],
	[
		"latency",
		"LAT",
		"right",
		6,
		4,
		(m) => fmtSeconds(m.latency),
		"first-token latency, s",
		goodLatency,
	],
	["context", "CTX", "right", 7, 0, (m) => fmtCount(m.contextWindow), "context window in tokens"],
	[
		"max-out",
		"MAXOUT",
		"right",
		7,
		4,
		(m) => fmtCount(m.maxOutputTokens),
		"maximum output tokens",
	],
	["price-in", "IN", "right", 8, 0, (m) => priceOf(m, "input"), "USD per 1M input", goodFreeIn],
	[
		"price-out",
		"OUT",
		"right",
		8,
		0,
		(m) => priceOf(m, "output"),
		"USD per 1M output",
		goodFreeOut,
	],
	["blended", "BLEND", "right", 8, 3, (m) => priceOf(m, "blended"), "blended USD per 1M"],
	["released", "RELEASED", "left", 10, 1, (m) => fmtDate(m.release.date), "release date"],
	["open", "OPEN", "left", 6, 0, (m) => fmtOpen(m.openWeights), "open weights state", goodOpen],
	[
		"efforts",
		"EFFORT",
		"left",
		12,
		5,
		(m) => m.reasoning.efforts.join(",") || EMPTY,
		"effort labels",
	],
];

function goodFreeIn(m: Model): boolean {
	return freeAt(m, "input");
}

function goodFreeOut(m: Model): boolean {
	return freeAt(m, "output");
}

function goodOpen(m: Model): boolean {
	return m.openWeights === true;
}

export const COLUMNS: Column[] = SPECS.map(
	([id, header, align, gain, drop, value, desc, good]) => ({
		id,
		header,
		align,
		gain,
		value,
		desc,
		...(drop === 0 ? {} : { drop }),
		...(good === undefined ? {} : { good }),
	}),
);

export const DEFAULT_COLUMNS = [
	"name",
	"creator",
	"intel",
	"tps",
	"context",
	"price-in",
	"price-out",
	"released",
	"open",
];

export function columnIds(): string[] {
	return COLUMNS.map((column) => column.id);
}

/** Columns in the order the user named them; an unknown id is named in the error. */
export function pickColumns(ids: string[]): Column[] {
	return ids.map((id) => {
		const column = COLUMNS.find((candidate) => candidate.id === id);
		if (!column) throw new Error(`unknown column "${id}" — see --columns help`);
		return column;
	});
}
