import { PROVIDER_COLOR, SGR } from "~/constants/view.ts";
import type { CompareRow } from "~/types.ts";
import { footer } from "./footer.ts";
import { tally } from "./layout/segments.ts";
import { printTable } from "./layout/table.ts";
import type { ReportMeta } from "./schema.ts";
import { paint, planTitle, setColor, setColorMode } from "./text/index.ts";
import { setAbilityRange, setThresholds } from "./text/styles.ts";

export { fitColumns, tableWidth } from "./layout/fit.ts";
export { tally } from "./layout/segments.ts";
export { columns } from "./schema.ts";
export { renderCsv, renderMarkdown } from "./text/export.ts";
export {
	fmtUsd,
	planTitle,
	providerName,
	shortProviderName,
} from "./text/index.ts";
export { setAbilityRange, setColor, setColorMode, setThresholds };

export function renderText(
	rows: CompareRow[],
	meta: ReportMeta,
	columnIds: string[],
	dropped: string[] = [],
): void {
	// The ability column ranks across the rows on screen, like COST/VAL.
	const abilities = rows
		.map((row) => row.oc?.ability ?? row.cc?.ability)
		.filter((value): value is number => typeof value === "number");
	if (abilities.length > 0) {
		setAbilityRange(Math.min(...abilities), Math.max(...abilities));
	}
	printTable(rows, columnIds, {
		oc: { title: planTitle(meta.ocPlan), color: PROVIDER_COLOR["oc-go"] },
		cc: { title: planTitle(meta.ccPlan), color: PROVIDER_COLOR.cc },
	});
	if (dropped.length > 0) {
		console.log(
			paint(
				SGR.dim,
				`\ndropped for width: ${[...new Set(dropped)].join(", ")} (use --columns to force, --width <n> to widen)`,
			),
		);
	}
	console.log();
	footer(rows, meta);
}

export function renderJson(rows: CompareRow[], meta: ReportMeta): string {
	return JSON.stringify(
		{
			workloads: meta.workloads,
			plans: { "oc-go": meta.ocPlan, cc: meta.ccPlan },
			tally: tally(rows),
			rows,
		},
		null,
		2,
	);
}
