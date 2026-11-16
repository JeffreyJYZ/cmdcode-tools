import { CSV_HEADER } from "#~/constants/view.ts";
import type { PlanInfo, SideId } from "#~/types.ts";
import type { Row, Tally } from "#~/view/schema.ts";
import { fmtAbility, fmtCount, fmtTps, planTitle, shortProviderName } from "./format.ts";

function csvCell(value: string | number): string {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const SIDES: SideId[] = ["oc-go", "cc", "od"];

/** OpenDesign's "Go" collides with OpenCode's, so its plan cell carries the product. */
function planCell(provider: SideId, plan: string): string {
	return provider === "od" ? `OpenDesign ${plan}` : plan;
}

function sideOf(row: Row, provider: SideId) {
	if (provider === "oc-go") return row.oc;
	if (provider === "od") return row.od;
	return row.cc;
}

/** One line per model-plan entry, so a spreadsheet can pivot it. */
export function renderCsv(rows: Row[], summary: Tally): string {
	const lines = [CSV_HEADER.join(",")];
	for (const row of rows) {
		for (const provider of SIDES) {
			const entry = sideOf(row, provider);
			if (!entry) continue;
			lines.push(
				[
					row.name,
					planCell(provider, entry.plan),
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
	const wins = [summary.ocWins, summary.ccWins];
	if (summary.odWins > 0 || summary.odOnly > 0) wins.push(summary.odWins);
	lines.push(
		`# head-to-head ${summary.headToHead} · OC/CC/OD ${wins.join("/")} · tie ${summary.ties}`,
	);
	return `${lines.join("\n")}\n`;
}

/** Markdown table with the default columns, one block per compared plan. */
export function renderMarkdown(rows: Row[], plans: PlanInfo[]): string {
	const perPlan = plans.flatMap((plan) => [
		`${shortProviderName(plan.provider)} req/mo`,
		`${shortProviderName(plan.provider)} $/1K`,
	]);
	const lines = [
		`# ${plans.map(planTitle).join(" vs ")}`,
		"",
		`| model | ${perPlan.join(" | ")} | ability | tps | COST | VAL |`,
		`| --- | ${perPlan.map(() => "---:").join(" | ")} | ---: | ---: | ---: | ---: |`,
	];
	const perK = (value: number): string => `$${fmtCount(value * 1000)}`;
	for (const row of rows) {
		const cells = [row.name];
		for (const plan of plans) {
			const entry = sideOf(row, plan.provider);
			cells.push(entry ? fmtCount(entry.requestsPerMonth) : "—");
			cells.push(entry ? perK(entry.payPerRequest) : "—");
		}
		cells.push(
			fmtAbility(row),
			fmtTps(row),
			String(
				100 - Math.max(row.oc?.index ?? -1, row.cc?.index ?? -1, row.od?.index ?? -1, 0),
			),
			String(
				Math.max(
					row.oc?.valueIndex ?? -1,
					row.cc?.valueIndex ?? -1,
					row.od?.valueIndex ?? -1,
				),
			),
		);
		lines.push(`| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
	}
	return `${lines.join("\n")}\n`;
}
