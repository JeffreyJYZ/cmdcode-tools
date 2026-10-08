import type { Projection } from "~/market/project.ts";
import type { RateEntry } from "~/market/rates.ts";
import type { DropCount, Shape } from "~/types.ts";
import type { Report } from "~/view/render.ts";

export function entry(overrides: Partial<RateEntry> = {}): RateEntry {
	return {
		key: "k",
		model: "Kimi K3",
		provider: "cc",
		plan: "GOAT",
		input: 1,
		output: 2,
		cacheRead: 0.5,
		cacheWrite: null,
		allowance: 70,
		ratio5h: 0.2,
		ratioWeek: 0.5,
		free: false,
		...overrides,
	};
}

export function projection(overrides: Partial<Projection> = {}): Projection {
	return {
		entry: entry(),
		costPerReq: 0.00231,
		requestsPerMonth: 30_000,
		requestsPerFiveHour: 6_000,
		requestsPerWeek: 15_000,
		cacheAtInput: false,
		writeAtInput: true,
		...overrides,
	};
}

const STATS = { mean: 8_300, p10: 67, p50: 1_000, p90: 9_500, max: 99_000 };

export function shape(overrides: Partial<Shape> = {}): Shape {
	return {
		reqs: 7_200,
		asks: 1_084,
		sessions: 38,
		projects: 8,
		first: Date.UTC(2026, 6, 10),
		last: Date.UTC(2026, 8, 29),
		stats: {
			input: STATS,
			output: STATS,
			reasoning: STATS,
			cacheRead: STATS,
			cacheWrite: STATS,
			cost: STATS,
		},
		perReq: {
			input: 8_300,
			output: 307,
			reasoning: 137,
			cacheRead: 248_000,
			cacheWrite: 8.2,
		},
		perSession: {
			input: 10_400,
			output: 215,
			reasoning: 100,
			cacheRead: 64_000,
			cacheWrite: 5,
		},
		sides: {
			oc: {
				reqs: 4_582,
				profile: {
					input: 9_100,
					output: 320,
					reasoning: 140,
					cacheRead: 210_000,
					cacheWrite: 9,
				},
			},
			cc: {
				reqs: 4_836,
				profile: {
					input: 7_100,
					output: 290,
					reasoning: 130,
					cacheRead: 295_000,
					cacheWrite: 7,
				},
			},
		},
		buckets: [
			{ label: "1", reqs: 28, input: 8_500, output: 75, cacheRead: 579 },
			{
				label: "101+",
				reqs: 5_701,
				input: 7_900,
				output: 297,
				cacheRead: 301_800,
			},
		],
		modelTotal: 1,
		models: [{ name: "deepseek/deepseek-v4.1-flash", reqs: 2_700 }],
		...overrides,
	};
}

export const DROPS: DropCount[] = [
	{ reason: "trivial prompt", asks: 137, reqs: 140 },
];

export function report(overrides: Partial<Report> = {}): Report {
	return {
		shape: shape(),
		projections: [projection()],
		total: 1,
		drops: DROPS,
		weight: "turn",
		account: null,
		layout: "v2",
		explain: false,
		...overrides,
	};
}
