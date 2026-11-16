import { buildRows, type OdSide } from "#~/cli/engine/index.ts";
import type { ScoreConfig } from "#~/cli/engine/score.ts";
import type { Options } from "#~/cli/options.ts";
import { loadAbility } from "#~/data/bench/index.ts";
import { loadShapes } from "#~/data/shape.ts";
import { loadCcCatalog } from "#~/data/sources/cc/catalog.ts";
import { loadCcPlan } from "#~/data/sources/cc/plans.ts";
import { loadOdCatalog, odPlan } from "#~/data/sources/od/index.ts";
import { loadOcGoCatalog, ocGoPlan } from "#~/data/sources/opencode.ts";
import type { SideId, Workload } from "#~/types.ts";

function scoreConfig(options: Options): ScoreConfig {
	return {
		abilityWeight: options.benchWeight,
		tpsWeight: options.tpsWeight,
		valWeights: options.valWeights,
		scale: options.scale,
		inheritSuffixes: options.inheritSuffixes,
		window: options.window,
	};
}

export async function collect(options: Options) {
	const [ocEntries, ccEntries, ccPlanInfo, shape] = await Promise.all([
		loadOcGoCatalog(options.ocPlan, options.peak),
		loadCcCatalog(options.ccPlan),
		loadCcPlan(options.ccPlan),
		loadShapes(options.shape, options.since),
	]);
	// OpenDesign publishes multipliers and estimates, not token rates, so its
	// rows are priced from the two catalogs above — which is why it loads after
	// them rather than beside them.
	const od = options.odPlan
		? loadOdCatalog(options.odPlan, { "oc-go": ocEntries, cc: ccEntries })
		: undefined;
	// A measured shape prices every side on the same request, so the comparison
	// isolates price and allowance from traffic; otherwise all fall back to the
	// single documented fixed workload.
	const workload = shape.workload ?? options.workload;
	const workloads: Partial<Record<SideId, Workload>> = {
		"oc-go": workload,
		cc: workload,
	};
	if (options.odPlan) workloads.od = workload;
	// Ability is loaded after the catalogs so fills can be limited to our rows.
	const keys = new Set(
		[...ocEntries, ...ccEntries, ...(od?.entries ?? [])].map((entry) => entry.key),
	);
	const ability = options.noAbility
		? {
				intelligence: new Map<string, number>(),
				tps: new Map<string, number>(),
				label: "",
				note: undefined as string | undefined,
			}
		: await loadAbility({
				source: options.bench,
				key: options.aaKey,
				keys,
				fallback: !options.noFallback,
			});
	const ocPlanInfo = ocGoPlan(ocEntries, options.ocPlan);
	const odSide: OdSide | undefined =
		od && options.odPlan ? { entries: od.entries, plan: odPlan(options.odPlan) } : undefined;
	const rows = buildRows(
		ocEntries,
		ccEntries,
		ocPlanInfo,
		ccPlanInfo,
		workloads,
		ability.intelligence,
		ability.tps,
		scoreConfig(options),
		odSide,
	);
	return {
		ocEntries,
		ccEntries,
		odLoad: od,
		ocPlanInfo,
		ccPlanInfo,
		odPlanInfo: odSide?.plan,
		rows,
		ability,
		workloads,
		shapeNote: shape.note,
	};
}
