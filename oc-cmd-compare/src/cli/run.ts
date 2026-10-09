#!/usr/bin/env bun
import { COLUMN_HELP, COLUMN_IDS } from "#~/constants/view.ts";
import { loadUsage } from "#~/data/usage/index.ts";
import { renderUsage } from "#~/view/layout/usage.ts";
import {
	fitColumns,
	planTitle,
	renderCsv,
	renderJson,
	renderMarkdown,
	renderText,
	setColorMode,
	setThresholds,
	tally,
} from "#~/view/render.ts";
import { describeConfig, resolveBag } from "./config.ts";
import { project } from "./engine/project.ts";
import { runCheck } from "./flow/check.ts";
import { collect } from "./flow/collect.ts";
import { resolveColumns, trimsToWidth } from "./flow/columns.ts";
import { matches, sortRows } from "./flow/sort.ts";
import { toOptions } from "./parse/map.ts";
import { assertKnown, assertValues } from "./parse/validate.ts";

export type { Metric, Options } from "./options.ts";
export { parseArgs } from "./parse/cac.ts";

export async function run(argv: string[]): Promise<number> {
	const bag = await resolveBag(argv);
	// cac prints the help text / version line itself and returns the parsed bag
	// (with the `h`/`v` aliases) instead of exiting, so stop here — otherwise the
	// full table would print after the help, and the aliases would trip assertKnown.
	if (
		bag.help === true ||
		bag.h === true ||
		bag.version === true ||
		bag.v === true
	) {
		return 0;
	}
	if (bag.printConfig === true) {
		// This is the one mode meant to check a config, so a typo must fail here
		// rather than on the next real run.
		assertKnown(bag);
		assertValues(bag);
		process.stdout.write(describeConfig(bag));
		return 0;
	}
	const options = toOptions(bag);
	if (options.columns?.includes("help")) {
		console.log(COLUMN_HELP);
		return 0;
	}

	setColorMode(options.colorMode);
	setThresholds(options.costThresholds, options.valThresholds);

	const requested = resolveColumns(options);
	const unknown = requested.filter((id) => !COLUMN_IDS.includes(id));
	if (unknown.length > 0) {
		throw new Error(
			`unknown column(s): ${unknown.join(", ")} — valid: ${COLUMN_IDS.join(", ")}`,
		);
	}

	const {
		ocEntries,
		ccEntries,
		ocPlanInfo,
		ccPlanInfo,
		rows,
		ability,
		workloads,
		shapeNote,
	} = await collect(options);
	if (options.check) {
		return runCheck(options, ocEntries, ccEntries, rows, ability);
	}

	if (options.usage) {
		const usage = await loadUsage(
			options.usageFile,
			options.usageWindow,
			options.usageLog,
			options.usageDb,
		);
		const projection = project(
			usage.entries,
			{ "oc-go": ocEntries, cc: ccEntries },
			{ "oc-go": ocPlanInfo, cc: ccPlanInfo },
			{ months: options.usageMonths },
		);
		if (options.format === "json" || options.json) {
			console.log(
				JSON.stringify({ source: usage.label, ...projection }, null, 2),
			);
			return 0;
		}
		renderUsage(projection, {
			label: usage.label,
			window: usage.window,
			account: usage.account,
			months: options.usageMonths,
			plans: { "oc-go": ocPlanInfo, cc: ccPlanInfo },
		});
		return 0;
	}

	const result = sortRows(
		rows.filter(
			(r) =>
				matches(r, options.model) &&
				(options.only === "all" || (r.oc && r.cc)),
		),
		options.metric,
		options.asc,
	);
	const meta = {
		ocPlan: ocPlanInfo,
		ccPlan: ccPlanInfo,
		workloads,
		abilityLabel: options.noAbility
			? undefined
			: (options.benchName ?? ability.label),
		abilityNote: options.noAbility ? undefined : ability.note,
		shapeNote,
		window: options.window,
	};

	if (options.format === "json" || options.json) {
		console.log(renderJson(result, meta));
		return 0;
	}
	if (options.format === "csv") {
		process.stdout.write(renderCsv(result, tally(result)));
		return 0;
	}
	if (options.format === "md") {
		process.stdout.write(renderMarkdown(result, [ocPlanInfo, ccPlanInfo]));
		return 0;
	}

	const limit = options.width ?? process.stdout.columns ?? 120;
	const fitted = trimsToWidth(options)
		? fitColumns(result, requested, limit)
		: { ids: requested, dropped: [] as string[] };
	renderText(result, meta, fitted.ids, fitted.dropped);
	console.log(
		`\n${result.length} models · ${planTitle(ocPlanInfo)} vs CommandCode ${ccPlanInfo.label} · ${ocEntries.length} OpenCode / ${ccEntries.length} CommandCode entries`,
	);
	return 0;
}
