import { CELL, MONEY, NAME, PLAN } from "~/constants/layout.ts";
import type { Projection } from "~/market/project.ts";
import { planLabel } from "~/market/rates.ts";
import { dim, fmtCount, fmtUsd, pad } from "./format.ts";

export function tableHeader(): string {
	return [
		pad("MODEL", NAME),
		pad("PLAN", PLAN),
		pad("$/req", MONEY, "right"),
		pad("req/mo", CELL, "right"),
		pad("req/5h", CELL, "right"),
		pad("req/wk", CELL, "right"),
	]
		.join("  ")
		.trimEnd();
}

export function tableRule(): string {
	return dim(
		[
			"─".repeat(NAME),
			"─".repeat(PLAN),
			"─".repeat(MONEY),
			"─".repeat(CELL),
			"─".repeat(CELL),
			"─".repeat(CELL),
		].join("  "),
	);
}

export function tableBody(projections: Projection[]): string[] {
	return projections.map((projection) => {
		// Only the cache-read case is worth flagging: it is 300K tokens a request,
		// where a cache write is a rounding error.
		const mark = projection.cacheAtInput ? " *" : "";
		return [
			pad(projection.entry.model, NAME),
			pad(planLabel(projection.entry), PLAN),
			pad(fmtUsd(projection.costPerReq), MONEY, "right"),
			pad(fmtCount(projection.requestsPerMonth), CELL, "right"),
			pad(
				projection.requestsPerFiveHour === null
					? "—"
					: fmtCount(projection.requestsPerFiveHour),
				CELL,
				"right",
			),
			pad(
				projection.requestsPerWeek === null
					? "—"
					: fmtCount(projection.requestsPerWeek),
				CELL,
				"right",
			),
		]
			.join("  ")
			.trimEnd()
			.concat(mark);
	});
}
