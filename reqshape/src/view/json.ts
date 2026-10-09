import type { Projection } from "#~/market/project.ts";
import { providerName } from "#~/market/rates.ts";
import type { DropCount, Shape } from "#~/types.ts";

export interface JsonInput {
	shape: Shape;
	projections: Projection[];
	drops: DropCount[];
	weight: "turn" | "session";
	layout: string;
	/** The token vector every projection was priced against. */
	profile: Record<string, number>;
}

/**
 * Machine-readable output. `requestsPerMonth` is null when a model costs
 * nothing per request, since JSON has no infinity — that is unbounded, not
 * unknown.
 */
export function renderJson(input: JsonInput): string {
	const payload = {
		weight: input.weight,
		store: input.layout,
		profile: input.profile,
		sides: input.shape.sides,
		shape: input.shape,
		drops: input.drops,
		models: input.projections.map((projection) => ({
			key: projection.entry.key,
			model: projection.entry.model,
			provider: projection.entry.provider,
			providerName: providerName(projection.entry.provider),
			plan: projection.entry.plan,
			pricing: {
				input: projection.entry.input,
				output: projection.entry.output,
				cacheRead: projection.entry.cacheRead,
				cacheWrite: projection.entry.cacheWrite,
			},
			allowance: projection.entry.allowance,
			costPerRequest: projection.costPerReq,
			requestsPerMonth: projection.requestsPerMonth,
			requestsPerFiveHour: projection.requestsPerFiveHour,
			requestsPerWeek: projection.requestsPerWeek,
			cacheAtInput: projection.cacheAtInput,
			writeAtInput: projection.writeAtInput,
			free: projection.entry.free,
		})),
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
}
