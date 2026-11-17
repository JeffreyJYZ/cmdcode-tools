import { DEFAULT_SCORE } from "#~/constants/scoring.ts";
import type {
	CatalogEntry,
	CompareRow,
	EntryMetrics,
	PlanInfo,
	SideId,
	Workload,
} from "#~/types.ts";
import { buildMetrics } from "./index.ts";
import type { ScoreConfig } from "./score.ts";

/** The optional third side: present only when `--od-plan` named a plan. */
export interface OdSide {
	entries: CatalogEntry[];
	plan: PlanInfo;
}

function indexByKey(entries: CatalogEntry[], metrics: EntryMetrics[]): Map<string, EntryMetrics> {
	const byKey = new Map<string, EntryMetrics>();
	entries.forEach((entry, i) => {
		const metric = metrics[i];
		if (metric) byKey.set(entry.key, metric);
	});
	return byKey;
}

export function buildRows(
	ocEntries: CatalogEntry[],
	ccEntries: CatalogEntry[],
	ocPlan: PlanInfo,
	ccPlan: PlanInfo,
	workloads: Partial<Record<SideId, Workload>>,
	ability: Map<string, number> = new Map(),
	tps: Map<string, number> = new Map(),
	config: ScoreConfig = DEFAULT_SCORE,
	od?: OdSide,
): CompareRow[] {
	const plans = new Map<SideId, PlanInfo>([
		["oc-go", ocPlan],
		["cc", ccPlan],
	]);
	const odEntries = od?.entries ?? [];
	if (od) plans.set("od", od.plan);
	// Score every entry from every compared side against one shared scale.
	const all = buildMetrics(
		[...ocEntries, ...ccEntries, ...odEntries],
		plans,
		workloads,
		ability,
		tps,
		config,
	);
	const ocByKey = indexByKey(ocEntries, all.slice(0, ocEntries.length));
	const ccByKey = indexByKey(
		ccEntries,
		all.slice(ocEntries.length, ocEntries.length + ccEntries.length),
	);
	const odByKey = indexByKey(odEntries, all.slice(ocEntries.length + ccEntries.length));

	const keys = new Set([...ocByKey.keys(), ...ccByKey.keys(), ...odByKey.keys()]);
	const rows: CompareRow[] = [];
	for (const key of keys) {
		const ccEntry = ccEntries.find((e) => e.key === key);
		const ocEntry = ocEntries.find((e) => e.key === key);
		const odEntry = odEntries.find((e) => e.key === key);
		rows.push({
			key,
			name: odEntry?.name ?? ccEntry?.name ?? ocEntry?.name ?? key,
			oc: ocByKey.get(key),
			cc: ccByKey.get(key),
			od: odByKey.get(key),
		});
	}
	return rows;
}
