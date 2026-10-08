import type { ProviderId } from "~/types.ts";
import { CC_COLUMNS } from "~/view/columns/cc.ts";
import { OC_COLUMNS } from "~/view/columns/oc.ts";

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
export const PROVIDER_COLOR: Record<ProviderId, string> = {
	"oc-go": "1;36",
	cc: "1;35",
};

/** The same identity as a quiet tint, for a provider's whole column set. */
export const PROVIDER_TINT: Record<ProviderId, string> = {
	"oc-go": "36",
	cc: "35",
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

/** Every column the table can render, keyed by the id used with --columns. */
export const COLUMN_IDS = [
	"model",
	...Object.keys(OC_COLUMNS),
	...Object.keys(CC_COLUMNS),
	"win",
	"cost",
	"ability",
	"tps",
	"deal",
	"val",
];

export const LEGEND: [string, string][] = [
	["rates", "token price per 1M tokens, in/out/cache"],
	["allow", "monthly credits this plan gives the model"],
	["5h wk mo", "requests the rolling 5-hour / weekly / monthly window buys"],
	["$/1K", "your cost per 1,000 requests, at the plan's price"],
	["req/$", "requests one dollar of subscription buys"],
	[
		"DEAL",
		"active CommandCode promotion: -98%, Free, 2x usage (expiry line is in --json)",
	],
	[
		"WIN",
		"cheaper side: OC / CC / tie · 'x only' = only that provider has it",
	],
	["ability", "benchmark score for the model (source above)"],
	["tps", "output tokens per second (source above)"],
	["COST", "0-100 volume index: requests/mo, lower is better (no ability)"],
	[
		"VAL",
		"0-100 ability-aware value: ability + speed + volume + cache + output",
	],
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

export const COLUMN_HELP = `Available columns (--columns a,b,c):
  model            model name
  oc-rates         OpenCode in/out/cache token rates ($/M)
  oc-allow         OpenCode monthly allowance for the model
  oc-req5h         requests the OpenCode 5-hour window allows
  oc-reqwk         requests the OpenCode weekly window allows
  oc-reqmo         requests the OpenCode monthly allowance buys
  oc-per1k         OpenCode cost per 1,000 requests
  oc-reqdollar     OpenCode requests per $1 of subscription
  cc-*             the same set for the CommandCode plan
  ability          benchmark score for the model
  tps              output tokens per second
  deal             active CommandCode promotion (-98%, Free, 2x usage)
  win              side with the lower per-request cost
  cost             0-100 cost index, lower is better
  val              0-100 ability-aware value score

Presets: default   = every column, trimmed to the terminal width (--no-fit keeps them all)
         --minimal = model + req/mo both sides + win + val
         --medium  = allowance and the rate views per side + win + cost + val
         --detail  = every column, untrimmed (for copy/paste or agents)
         --columns = an exact list; bypasses presets and trimming`;
