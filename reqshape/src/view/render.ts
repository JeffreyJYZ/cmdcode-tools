import type { Projection } from "#~/market/project.ts";
import type { AccountSummary } from "#~/market/sources.ts";
import type { DropCount, Shape } from "#~/types.ts";
import { bold, dim, fmtCount, fmtInt } from "./format.ts";
import {
	block,
	dropLines,
	measured,
	models,
	perReq,
	position,
	sides,
} from "./sections.ts";
import { tableBody, tableHeader, tableRule } from "./table.ts";

export interface Report {
	shape: Shape;
	projections: Projection[];
	/** Rows the catalogue held before --model / --limit narrowed them. */
	total: number;
	drops: DropCount[];
	weight: "turn" | "session";
	account: AccountSummary | null;
	layout: string;
	explain: boolean;
}

export function renderText(report: Report): string {
	const { shape, projections, weight } = report;
	const out: string[] = [];

	out.push(
		`${bold("reqshape")}  ${fmtCount(shape.reqs)} reqs · ${
			weight === "session"
				? "each conversation one vote"
				: "every req weighted equally"
		}`,
		dim(
			`measured from the opencode ${report.layout} store · priced by mpc`,
		),
		"",
		...block("MEASURED", measured(shape)),
		...block("DROPPED", dropLines(report.drops, report.explain)),
		"",
		...block("PER REQ", perReq(shape, weight)),
		"",
		...block("PER SIDE", sides(shape)),
		"",
		...block("POSITION", position(shape)),
		"",
		...block("MODELS", models(shape)),
		"",
	);

	if (projections.length === 0) {
		out.push("no model rows to price");
	} else {
		out.push(
			...block("PROJECTED", [
				dim("what the plan's allowance buys at the measured shape"),
			]),
			"",
			tableHeader(),
			tableRule(),
			...tableBody(projections),
			"",
		);
		if (report.total > projections.length) {
			out.push(
				dim(
					`showing ${fmtInt(projections.length)} of ${fmtInt(report.total)} model-plans`,
				),
			);
		}
		if (projections.some((projection) => projection.cacheAtInput)) {
			out.push(
				dim(
					"* publishes no cache-read rate, so the context is billed at the input rate",
				),
			);
		}
	}

	if (report.account) {
		out.push(
			dim(
				`CC account  ${fmtInt(report.account.requests)} reqs this period · ${report.account.plan} · ends ${report.account.periodEnd}`,
			),
		);
	}

	return `${out
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd()}\n`;
}
