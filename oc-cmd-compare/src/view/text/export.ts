import { CSV_HEADER } from "#~/constants/view.ts";
import type { PlanInfo } from "#~/types.ts";
import type { Row, Tally } from "#~/view/schema.ts";
import { fmtAbility, fmtCount, fmtTps, planTitle } from "./format.ts";

function csvCell(value: string | number): string {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One line per model-provider entry, so a spreadsheet can pivot it. */
export function renderCsv(rows: Row[], summary: Tally): string {
	const lines = [CSV_HEADER.join(",")];
	for (const row of rows) {
		for (const entry of [row.oc, row.cc]) {
			if (!entry) continue;
			lines.push(
				[
					row.name,
					entry.plan,
					entry.allowance,
					Number.isFinite(entry.requestsPerMonth)
						? Math.round(entry.requestsPerMonth)
						: "inf",
					(entry.payPerRequest * 1000).toPrecision(6),
					entry.payPerRequest.toPrecision(6),
					entry.ability ?? "",
					entry.tps ?? "",
					100 - entry.index,
					entry.valueIndex ?? "",
				]
					.map(csvCell)
					.join(","),
			);
		}
	}
	lines.push(
		`# head-to-head ${summary.headToHead} · OC ${summary.ocWins} · CC ${summary.ccWins} · tie ${summary.ties}`,
	);
	return `${lines.join("\n")}\n`;
}

/** Markdown table with the default columns. */
export function renderMarkdown(
	rows: Row[],
	plans: [PlanInfo, PlanInfo],
): string {
	const lines = [
		`# ${planTitle(plans[0])} vs ${planTitle(plans[1])}`,
		"",
		"| model | OC req/mo | OC $/1K | CC req/mo | CC $/1K | ability | tps | COST | VAL |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
	];
	const perK = (value: number): string => `$${fmtCount(value * 1000)}`;
	for (const row of rows) {
		const cells = [
			row.name,
			row.oc ? fmtCount(row.oc.requestsPerMonth) : "—",
			row.oc ? perK(row.oc.payPerRequest) : "—",
			row.cc ? fmtCount(row.cc.requestsPerMonth) : "—",
			row.cc ? perK(row.cc.payPerRequest) : "—",
			fmtAbility(row),
			fmtTps(row),
			String(100 - Math.max(row.oc?.index ?? -1, row.cc?.index ?? -1, 0)),
			String(row.oc?.valueIndex ?? row.cc?.valueIndex ?? "—"),
		];
		lines.push(
			`| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`,
		);
	}
	return `${lines.join("\n")}\n`;
}
