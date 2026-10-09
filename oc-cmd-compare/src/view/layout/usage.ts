import type { UsageProjection, UsageRow } from "#~/cli/engine/project.ts";
import { HEADERS, SGR } from "#~/constants/view.ts";
import type { PlanInfo, ProviderId } from "#~/types.ts";
import { fmtCount, fmtUsd, paint, planTitle } from "#~/view/text/index.ts";

export interface UsageMeta {
	label: string;
	window: string;
	account?: { requests: number; cost: number };
	months: number;
	plans: Record<ProviderId, PlanInfo>;
}

function money(value: number | undefined): string {
	if (value === undefined || value === 0) return "—";
	return fmtUsd(value);
}

function perReq(value: number | undefined): string {
	if (value === undefined) return "—";
	return fmtUsd(value);
}

function cells(row: UsageRow): string[] {
	const oc = row.oc;
	const cc = row.cc;
	const cheaper =
		oc && cc
			? oc.payPerRequest === cc.payPerRequest
				? "tie"
				: oc.payPerRequest < cc.payPerRequest
					? "OC"
					: "CC"
			: oc
				? "OC only"
				: "CC only";
	return [
		row.name,
		fmtCount(row.requests),
		money(row.listCost),
		perReq(row.cc?.payPerRequest),
		money(row.cc?.monthly),
		perReq(row.oc?.payPerRequest),
		money(row.oc?.monthly),
		cheaper,
		row.cc?.overCap || row.oc?.overCap ? "over cap" : "",
	];
}

export interface HeadToHead {
	/** Rows priced on both sides — the only ones a head-to-head can use. */
	shared: number;
	total: number;
	cc: number;
	oc: number;
	winner: "OpenCode" | "CommandCode" | "tie" | "none";
}

/**
 * Compare the plans on the models both of them price. Summing every row lets a
 * CC-only model add to CC's total and nothing to OpenCode's, which then "proves"
 * OpenCode cheaper on traffic it cannot serve at all — the artefact that made a
 * mix of one tied model plus two CC-only ones read as "OpenCode cheaper by 45%".
 */
export function headToHead(rows: UsageRow[]): HeadToHead {
	const shared = rows.filter((row) => row.oc && row.cc);
	const cc = shared.reduce((sum, row) => sum + (row.cc?.monthly ?? 0), 0);
	const oc = shared.reduce((sum, row) => sum + (row.oc?.monthly ?? 0), 0);
	if (shared.length === 0) {
		return { shared: 0, total: rows.length, cc: 0, oc: 0, winner: "none" };
	}
	return {
		shared: shared.length,
		total: rows.length,
		cc,
		oc,
		winner: cc > oc ? "OpenCode" : cc < oc ? "CommandCode" : "tie",
	};
}

function headToHeadLine(report: UsageProjection): string {
	const head = headToHead(report.rows);
	if (head.winner === "none") {
		return "        head-to-head  no model is priced on both sides — nothing to compare";
	}
	const excluded = head.total - head.shared;
	const note =
		excluded > 0
			? ` (${excluded} one-sided row${excluded === 1 ? "" : "s"} excluded)`
			: "";
	const delta = Math.abs(head.cc - head.oc);
	const pct = head.cc > 0 ? (delta / head.cc) * 100 : 0;
	const verdict =
		head.winner === "tie"
			? "tie"
			: `cheaper ${head.winner} by ${fmtUsd(delta)} (${pct.toFixed(0)}%)`;
	return `        head-to-head  ${head.shared} of ${head.total} models${note} · CC ${fmtUsd(head.cc)}/mo · OpenCode ${fmtUsd(head.oc)}/mo · ${verdict}`;
}

export function renderUsage(report: UsageProjection, meta: UsageMeta): void {
	const dim = (text: string): string => paint("2", text);
	const scale = meta.months === 1 ? "" : ` · scaled to ${meta.months} months`;
	console.log(
		paint(
			"1",
			`USAGE  your logged mix · ${meta.window}${scale} · list value ${fmtUsd(report.ccListCost)}${meta.months === 1 ? "" : "/mo"}`,
		),
	);
	console.log(`${paint(SGR.bold, "source")}  ${meta.label}`);
	const local = report.rows.reduce((sum, row) => sum + row.requests, 0);
	if (meta.account && meta.account.requests > 0) {
		const pct = (local / meta.account.requests) * 100;
		console.log(
			`${paint(SGR.bold, "cover")}   local usage ${fmtCount(local)} of ${fmtCount(meta.account.requests)} account requests (${pct.toFixed(0)}%)`,
		);
		if (pct < 90) {
			console.log(
				dim(
					"        partial: other machines/harnesses are missing — point --usage-log at the provider log, or use --usage-file",
				),
			);
		}
	}

	const rows = report.rows.map(cells);
	const widths = HEADERS.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
	);
	const line = (values: string[], rightSet: Set<number>): string =>
		values
			.map((v, i) =>
				rightSet.has(i)
					? v.padStart(widths[i] ?? 0)
					: v.padEnd(widths[i] ?? 0),
			)
			.join("  ");
	const right = new Set([1, 2, 3, 4, 5, 6]);

	console.log();
	console.log(paint("1", line(HEADERS, right)));
	console.log(widths.map((w) => "─".repeat(w)).join("  "));
	for (const row of rows) console.log(line(row, right));

	console.log();
	console.log(
		`${paint(SGR.bold, "totals")}  your mix · CC ${fmtUsd(report.ccMonthly)}/mo · OpenCode ${fmtUsd(report.ocMonthly)}/mo`,
	);
	console.log(headToHeadLine(report));
	console.log(
		`${paint(SGR.bold, "plans")}   ${planTitle(meta.plans["oc-go"])} $${meta.plans["oc-go"].price}/mo · ${planTitle(meta.plans.cc)} $${meta.plans.cc.price}/mo`,
	);
	const over = report.rows
		.filter((r) => r.cc?.overCap || r.oc?.overCap)
		.map((r) => r.name);
	if (over.length > 0) {
		console.log(dim(`over cap for at least one plan: ${over.join(", ")}`));
	}
	if (report.unmatched.length > 0) {
		console.log(
			dim(`unmatched models (excluded): ${report.unmatched.join(", ")}`),
		);
	}
}
