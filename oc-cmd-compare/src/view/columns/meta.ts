import { SGR } from "~/constants/view.ts";
import type { Column } from "~/view/schema.ts";
import * as f from "~/view/text/index.ts";

export const META_COLUMNS: Record<string, Column> = {
	model: { header: "MODEL", value: (r) => r.name, style: () => SGR.bold },
	win: { header: "WIN", value: f.winner, style: f.winnerStyle },
	cost: {
		header: "COST",
		value: f.bestCost,
		right: true,
		style: f.costStyle,
	},
	ability: {
		header: "ability",
		value: f.fmtAbility,
		right: true,
		style: f.abilityStyle,
	},
	tps: {
		header: "tps",
		value: f.fmtTps,
		right: true,
		style: (r) => f.enabledStyle(r.oc?.tps ?? r.cc?.tps ?? null),
		drop: 4,
	},
	deal: {
		header: "DEAL",
		// The badge alone: the expiry line would blow the column out, and it
		// rides along in --json for the sidebar, which has room for it.
		value: (r) => r.cc?.deal?.badge ?? "—",
		style: (r) => (r.cc?.deal ? SGR.green : SGR.dim),
		drop: 3,
	},
	val: {
		header: "VAL",
		value: f.bestValue,
		right: true,
		style: f.valueStyle,
	},
};
