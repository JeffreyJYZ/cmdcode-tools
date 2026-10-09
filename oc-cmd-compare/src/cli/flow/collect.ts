import { buildRows } from "#~/cli/engine/index.ts";
import type { ScoreConfig } from "#~/cli/engine/score.ts";
import type { Options } from "#~/cli/options.ts";
import { loadAbility } from "#~/data/bench/index.ts";
import { loadShapes } from "#~/data/shape.ts";
import { loadCcCatalog } from "#~/data/sources/cc/catalog.ts";
import { loadCcPlan } from "#~/data/sources/cc/plans.ts";
import { loadOcGoCatalog, ocGoPlan } from "#~/data/sources/opencode.ts";
import type { ProviderId, Workload } from "#~/types.ts";

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
	// A measured shape prices both sides on the same request, so the comparison
	// isolates price and allowance from traffic; otherwise both fall back to the
	// single documented fixed workload.
	const workload = shape.workload ?? options.workload;
	const workloads: Record<ProviderId, Workload> = {
		"oc-go": workload,
		cc: workload,
	};
	// Ability is loaded after the catalogs so fills can be limited to our rows.
	const keys = new Set(
		[...ocEntries, ...ccEntries].map((entry) => entry.key),
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
				refresh: options.refresh,
			});
	const ocPlanInfo = ocGoPlan(ocEntries, options.ocPlan);
	const rows = buildRows(
		ocEntries,
		ccEntries,
		ocPlanInfo,
		ccPlanInfo,
		workloads,
		ability.intelligence,
		ability.tps,
		scoreConfig(options),
	);
	return {
		ocEntries,
		ccEntries,
		ocPlanInfo,
		ccPlanInfo,
		rows,
		ability,
		workloads,
		shapeNote: shape.note,
	};
}
