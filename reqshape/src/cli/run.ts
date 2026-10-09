import { entriesOf } from "#~/market/entries.ts";
import { type Projection, projectAll } from "#~/market/project.ts";
import { customEntry, type RateEntry } from "#~/market/rates.ts";
import { loadAccount, loadMpc } from "#~/market/sources.ts";
import { buildAsks } from "#~/measure/asks.ts";
import { filterAsks } from "#~/measure/filter.ts";
import { buildShape } from "#~/measure/profile.ts";
import { readStore } from "#~/measure/store.ts";
import type { Profile } from "#~/types.ts";
import { setColorMode } from "#~/view/format.ts";
import { renderJson } from "#~/view/json.ts";
import { renderText } from "#~/view/render.ts";
import type { Options } from "./options.ts";
import { parseArgs } from "./parse.ts";

function colorEnabled(options: Options): boolean {
	if (options.color === "always") return true;
	if (options.color === "never") return false;
	return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

/** Most requests per month first. Free models tie rather than compare as NaN. */
function byRequestsPerMonth(a: Projection, b: Projection): number {
	if (a.requestsPerMonth === b.requestsPerMonth) return 0;
	return a.requestsPerMonth > b.requestsPerMonth ? -1 : 1;
}

function sortProjections(
	projections: Projection[],
	sort: Options["sort"],
): Projection[] {
	const sorted = [...projections];
	if (sort === "cost") {
		return sorted.sort((a, b) => a.costPerReq - b.costPerReq);
	}
	if (sort === "name") {
		return sorted.sort((a, b) =>
			a.entry.model.localeCompare(b.entry.model),
		);
	}
	return sorted.sort(byRequestsPerMonth);
}

/**
 * The catalogue comes from mpc, which already knows both plans' pricing,
 * allowances and window rules. A custom model is priced alongside it, and
 * carries the run when mpc is unavailable.
 */
function ratesOf(options: Options): RateEntry[] {
	let entries: RateEntry[] = [];
	try {
		entries = entriesOf(loadMpc(options.mpc));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (!options.custom) {
			throw new Error(
				`${detail}\nPass --in/--out/--budget to price a custom model instead.`,
			);
		}
		process.stderr.write(
			`reqshape: ${detail}\n          pricing the custom model only\n`,
		);
	}
	if (options.custom) entries.push(customEntry(options.custom));
	return entries;
}

export async function run(argv: string[]): Promise<number> {
	const options = parseArgs(argv);
	// cac has already written the help or version text.
	if (options.handled) return 0;
	setColorMode(colorEnabled(options));

	const store = readStore(options.db);
	const asks = buildAsks(store.messages, store.sessions);
	const { kept, drops } = filterAsks(asks, {
		sessions: options.sessions,
		keywords: new Set(options.keywords),
		minChars: options.minChars,
		minOutput: options.minOutput,
		keepTrivial: options.keepTrivial,
		since: options.since,
		project: options.project,
	});
	const shape = buildShape(kept);

	if (shape.reqs === 0) {
		const why =
			drops.map((drop) => `${drop.reason} ${drop.asks}`).join(" · ") ||
			"no requests found";
		process.stderr.write(
			`reqshape: nothing to price — no requests survived the filters (${why})\n`,
		);
		return 1;
	}

	const profile: Profile =
		options.weight === "session" ? shape.perSession : shape.perReq;

	let entries = ratesOf(options);
	const needle = options.model.trim().toLowerCase();
	if (needle) {
		entries = entries.filter((entry) =>
			entry.model.toLowerCase().includes(needle),
		);
	}
	const total = entries.length;
	let projections = sortProjections(
		projectAll(entries, profile),
		options.sort,
	);
	if (options.limit > 0) projections = projections.slice(0, options.limit);
	const account = options.account ? loadAccount(options.cmduse) : null;

	if (options.format === "json") {
		process.stdout.write(
			renderJson({
				shape,
				projections,
				drops,
				weight: options.weight,
				layout: store.layout,
				profile: { ...profile },
			}),
		);
		return 0;
	}

	process.stdout.write(
		renderText({
			shape,
			projections,
			drops,
			weight: options.weight,
			account,
			layout: store.layout,
			total,
			explain: options.explain,
		}),
	);
	return 0;
}
