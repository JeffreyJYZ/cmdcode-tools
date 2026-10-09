import type { Column } from "#~/view/schema.ts";
import * as f from "#~/view/text/index.ts";

export const CC_COLUMNS: Record<string, Column> = {
	"cc-rates": {
		header: "rates",
		value: f.ccRates,
		style: f.tintOrFree("cc"),
		drop: 1,
	},
	"cc-allow": {
		header: "allow",
		value: (r) => f.fmtAllowance(r.cc),
		right: true,
		style: f.tintOrFree("cc"),
	},
	"cc-req5h": {
		header: "5h",
		drop: 3,
		value: (r) => f.fmtRequests(r.cc?.requestsPerFiveHour, Boolean(r.cc)),
		right: true,
		style: f.tint("cc"),
	},
	"cc-reqwk": {
		header: "wk",
		drop: 3,
		value: (r) => f.fmtRequests(r.cc?.requestsPerWeek, Boolean(r.cc)),
		right: true,
		style: f.tint("cc"),
	},
	"cc-reqmo": {
		header: "mo",
		value: (r) => f.fmtRequests(r.cc?.requestsPerMonth, Boolean(r.cc)),
		right: true,
		style: f.tint("cc"),
	},
	"cc-per1k": {
		header: "$/1K",
		value: (r) => f.fmtPerThousand(r.cc),
		right: true,
		style: f.sideStyle("cc"),
	},
	"cc-reqdollar": {
		header: "req/$",
		value: (r) => f.fmtPerDollar(r.cc),
		right: true,
		style: f.sideStyle("cc"),
		drop: 2,
	},
};
