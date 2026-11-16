import type { Column } from "#~/view/schema.ts";
import * as f from "#~/view/text/index.ts";

export const OD_COLUMNS: Record<string, Column> = {
	"od-rates": {
		header: "rates",
		value: f.odRates,
		style: f.tintOrFree("od"),
		drop: 1,
	},
	"od-allow": {
		header: "allow",
		value: (r) => f.fmtAllowance(r.od),
		right: true,
		style: f.tintOrFree("od"),
	},
	"od-req5h": {
		header: "5h",
		drop: 3,
		// A dash covers both "no such window on this plan" (Plus and up) and
		// "model not offered here" — neither is a request count.
		value: (r) =>
			r.od && r.od.requestsPerFiveHour > 0
				? f.fmtRequests(r.od.requestsPerFiveHour, true)
				: "—",
		right: true,
		style: f.tint("od"),
	},
	"od-reqwk": {
		header: "wk",
		drop: 3,
		value: (r) => f.fmtRequests(r.od?.requestsPerWeek, Boolean(r.od)),
		right: true,
		style: f.tint("od"),
	},
	"od-reqmo": {
		header: "mo",
		value: (r) => f.fmtRequests(r.od?.requestsPerMonth, Boolean(r.od)),
		right: true,
		style: f.tint("od"),
	},
	"od-per1k": {
		header: "$/1K",
		value: (r) => f.fmtPerThousand(r.od),
		right: true,
		style: f.sideStyle("od"),
	},
	"od-reqdollar": {
		header: "req/$",
		value: (r) => f.fmtPerDollar(r.od),
		right: true,
		style: f.sideStyle("od"),
		drop: 2,
	},
};
