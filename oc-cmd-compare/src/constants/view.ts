import type { SideId } from "#~/types.ts";
import { CC_COLUMNS } from "#~/view/columns/cc.ts";
import { OC_COLUMNS } from "#~/view/columns/oc.ts";
import { OD_COLUMNS } from "#~/view/columns/od.ts";

/**
 * SGR codes with **one meaning each**. `green` = favourable (cheaper side, free,
 * a good score), `yellow` = middling score, `dim` = absent value or a structural
 * annotation — never a quality and never a side. Provider identity is
 * `PROVIDER_COLOR`, kept out of this scale so cyan never means "ability" too.
 */
export const SGR = {
	bold: "1",
	dim: "2",
	red: "31",
	green: "32",
	yellow: "33",
} as const;

/** Provider identity colour (bold), for banners, headers and a winning cell. */
export const PROVIDER_COLOR: Record<SideId, string> = {
	"oc-go": "1;36",
	cc: "1;35",
	od: "1;34",
};

/** The same identity as a quiet tint, for a provider's whole column set. */
export const PROVIDER_TINT: Record<SideId, string> = {
	"oc-go": "36",
	cc: "35",
	od: "34",
};

export const GAP = "  ";
export const BAR = " │ ";
export const BAR_RULE = "─┼─";

/** Fewest columns that still answer "which model, how many requests, who wins". */
export const MINIMAL_COLUMNS = ["model", "oc-reqmo", "cc-reqmo", "win", "val"];

/** The everyday middle set: allowance plus the three rate views per side. */
export const MEDIUM_COLUMNS = [
	"model",
	"oc-allow",
	"oc-reqmo",
	"oc-per1k",
	"oc-reqdollar",
	"cc-allow",
	"cc-reqmo",
	"cc-per1k",
	"cc-reqdollar",
	"win",
	"cost",
	"val",
];

/** Every column: the width-trimmed default, and `--detail` untrimmed. */
export const DETAIL_COLUMNS = [
	"model",
	"oc-rates",
	"oc-allow",
	"oc-req5h",
	"oc-reqwk",
	"oc-reqmo",
	"oc-per1k",
	"oc-reqdollar",
	"cc-rates",
	"cc-allow",
	"cc-req5h",
	"cc-reqwk",
	"cc-reqmo",
	"cc-per1k",
	"cc-reqdollar",
	"ability",
	"tps",
	"deal",
	"win",
	"cost",
	"val",
];

/** The OpenDesign block, appended to a preset when `--od-plan` is given. */
export const OD_COLUMN_IDS = [
	"od-rates",
	"od-allow",
	"od-req5h",
	"od-reqwk",
	"od-reqmo",
	"od-per1k",
	"od-reqdollar",
];

/** Per tier, only the OpenDesign columns that tier's shape has room for. */
export const OD_BY_TIER: Record<"minimal" | "medium" | "detail", string[]> = {
	minimal: ["od-reqmo"],
	medium: ["od-allow", "od-reqmo", "od-per1k", "od-reqdollar"],
	detail: OD_COLUMN_IDS,
};

/** Insert the OpenDesign block after the last standing plan's columns. */
export function withOd(ids: string[], od: string[]): string[] {
	const out = [...ids];
	const anchor = out.reduce(
		(last, id, i) => (id.startsWith("cc-") || id.startsWith("oc-") ? i : last),
		-1,
	);
	if (anchor < 0) return out;
	out.splice(anchor + 1, 0, ...od);
	return out;
}

/** Every column the table can render, keyed by the id used with --columns. */
export const COLUMN_IDS = [
	"model",
	...Object.keys(OC_COLUMNS),
	...Object.keys(CC_COLUMNS),
	...Object.keys(OD_COLUMNS),
	"win",
	"cost",
	"ability",
	"tps",
	"deal",
	"val",
];

export const CSV_HEADER = [
	"model",
	"plan",
	"allowance",
	"req_month",
	"usd_per_1k",
	"usd_per_request",
	"ability",
	"tps",
	"cost_index",
	"val_index",
];

export const HEADERS = [
	"MODEL",
	"your req",
	"your $",
	"CC $/req",
	"CC $/mo",
	"OC $/req",
	"OC $/mo",
	"cheaper",
	"flag",
];
