import { DEFAULT_SCORE } from "#~/constants/scoring.ts";
import type {
	CatalogEntry,
	CompareRow,
	EntryMetrics,
	PlanInfo,
	ProviderId,
	Workload,
} from "#~/types.ts";
import { buildMetrics } from "./index.ts";
import type { ScoreConfig } from "./score.ts";

function indexByKey(
	entries: CatalogEntry[],
	metrics: EntryMetrics[],
): Map<string, EntryMetrics> {
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
	workloads: Record<ProviderId, Workload>,
	ability: Map<string, number> = new Map(),
	tps: Map<string, number> = new Map(),
	config: ScoreConfig = DEFAULT_SCORE,
): CompareRow[] {
	const plans = new Map<ProviderId, PlanInfo>([
		["oc-go", ocPlan],
		["cc", ccPlan],
	]);
	// Score every entry from both providers against one shared scale.
	const all = buildMetrics(
		[...ocEntries, ...ccEntries],
		plans,
		workloads,
		ability,
		tps,
		config,
	);
	const ocByKey = indexByKey(ocEntries, all.slice(0, ocEntries.length));
	const ccByKey = indexByKey(ccEntries, all.slice(ocEntries.length));

	const keys = new Set([...ocByKey.keys(), ...ccByKey.keys()]);
	const rows: CompareRow[] = [];
	for (const key of keys) {
		const ccEntry = ccEntries.find((e) => e.key === key);
		const ocEntry = ocEntries.find((e) => e.key === key);
		rows.push({
			key,
			name: ccEntry?.name ?? ocEntry?.name ?? key,
			oc: ocByKey.get(key),
			cc: ccByKey.get(key),
		});
	}
	return rows;
}
