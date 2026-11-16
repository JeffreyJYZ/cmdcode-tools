// OpenDesign catalogue: the seed the picker always shows, the live `/v1/models`
// listing, and the model records built from both. The v2 editor glue (register,
// enable, apply) lives beside it in ./providerOpenDesign.ts.
//
// This endpoint publishes what Command Code's listing does not: every row
// carries `context_limit`, `output_budget` and its input modalities, so the seed
// and the live rows keep the API's own numbers instead of a default. Rates come
// only from `core/od.json` rows marked `rateSource: "repo"` — oduse's table,
// seeded from the published rates where the same model is sold elsewhere — and
// an `estimate` row stays unpriced rather than shown as a rate nobody published.
import od from "../../core/od.json";
import type { InputModality } from "./catalog";
import { OPEN_DESIGN_BASE } from "./constants/endpoints";
import { DEFAULT_CONTEXT_LENGTH, DEFAULT_OUTPUT_TOKENS } from "./constants/models";
import { OPEN_DESIGN_PROVIDER_ID } from "./constants/providers";
import { OPEN_DESIGN_TIMEOUT_MS } from "./constants/timing";

/** One OpenDesign model, in the shape both the seed and the live listing use. */
export type OpenDesignModel = {
	id: string;
	name: string;
	/** Listing `metadata.context_limit`; 0 = the listing published none. */
	context: number;
	/** Listing `metadata.output_budget`; 0 = the listing published none. */
	output: number;
	modalities: readonly InputModality[];
};

/** The picker's built-in rows, read off `GET /v1/models` on 2026-11-16. They are
 * the two this lane is for; the live listing adds the other twelve. */
export const OPEN_DESIGN_SEED: readonly OpenDesignModel[] = [
	{
		id: "deepseek-v4.1-flash",
		name: "DeepSeek V4.1 Flash",
		context: 1_048_000,
		output: 128_000,
		modalities: ["text", "image"],
	},
	{
		id: "deepseek-v4.1-flash-eco",
		name: "DeepSeek V4.1 Flash Eco",
		context: 1_048_000,
		output: 128_000,
		modalities: ["text"],
	},
];

/** Display names the published table knows; the listing carries only ids. */
const LABELS = new Map(od.models.map((m) => [m.id, m.label] as const));

function label(id: string): string {
	return LABELS.get(id) ?? id;
}

/** Published list-price $/1M from `core/od.json`. An `estimate` row is omitted:
 * the host then shows no price for that model, which is the honest reading. */
export function odCost(id: string): { input: number; output: number } | undefined {
	const row = od.models.find((m) => m.id === id && m.rateSource === "repo");
	return row ? { input: row.input, output: row.output } : undefined;
}

/** Modalities the host can declare. Anything the listing adds that the host has
 * no field for (`file`) is dropped rather than widening the union. */
const KNOWN_MODALITIES = new Set<string>(["text", "image", "audio", "video", "pdf"]);

function modalitiesOf(raw: unknown): readonly InputModality[] {
	if (!Array.isArray(raw)) return ["text"];
	const known = raw.filter(
		(m): m is InputModality => typeof m === "string" && KNOWN_MODALITIES.has(m),
	);
	return known.length > 0 ? known : ["text"];
}

type WireRow = {
	id?: unknown;
	name?: unknown;
	architecture?: { input_modalities?: unknown };
	metadata?: { context_limit?: unknown; output_budget?: unknown };
};

/** `/v1/models` → rows. A row without an id is skipped, and a row without limits
 * keeps 0 so the record builder can fall back instead of inventing a window. */
export function parseModelList(body: unknown): OpenDesignModel[] {
	const data = (body as { data?: unknown } | null)?.data;
	if (!Array.isArray(data)) return [];
	const out: OpenDesignModel[] = [];
	for (const raw of data) {
		const row = raw as WireRow;
		if (typeof row?.id !== "string" || row.id === "") continue;
		const meta = row.metadata ?? {};
		out.push({
			id: row.id,
			name: typeof row.name === "string" && row.name !== "" ? row.name : label(row.id),
			context: typeof meta.context_limit === "number" ? meta.context_limit : 0,
			output: typeof meta.output_budget === "number" ? meta.output_budget : 0,
			modalities: modalitiesOf(row.architecture?.input_modalities),
		});
	}
	return out;
}

/**
 * The lane's live listing. Never throws and never rejects: an outage, a bad key
 * or an empty payload answers undefined and the caller keeps its seed, so the
 * picker can neither wait on this call nor be emptied by it.
 */
export async function fetchModelList(key: string): Promise<OpenDesignModel[] | undefined> {
	try {
		const response = await fetch(`${OPEN_DESIGN_BASE}/models`, {
			headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
			signal: AbortSignal.timeout(OPEN_DESIGN_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const list = parseModelList(await response.json());
		return list.length > 0 ? list : undefined;
	} catch {
		return undefined;
	}
}

/** v2 Model.Info records. Cost is `[]` for a model with no published rate,
 * exactly as the Command Code lanes represent an unpriced model. */
export function modelRecords(list: readonly OpenDesignModel[]): unknown[] {
	return list.map((m) => {
		const cost = odCost(m.id);
		return {
			id: m.id,
			modelID: m.id,
			providerID: OPEN_DESIGN_PROVIDER_ID,
			name: m.name,
			capabilities: { tools: true, input: [...m.modalities], output: ["text"] },
			variants: [],
			time: { released: 0 },
			cost: cost
				? [{ input: cost.input, output: cost.output, cache: { read: 0, write: 0 } }]
				: [],
			status: "active",
			enabled: true,
			limit: {
				context: m.context > 0 ? m.context : DEFAULT_CONTEXT_LENGTH,
				output: m.output > 0 ? m.output : DEFAULT_OUTPUT_TOKENS,
			},
		};
	});
}

/** Union by id, live rows winning: a partial listing can add models but never
 * delete a seeded one. Snapshot order first, live-only ids appended. */
export function mergeModels(
	seed: readonly OpenDesignModel[],
	live: readonly OpenDesignModel[],
): OpenDesignModel[] {
	const byId = new Map<string, OpenDesignModel>();
	for (const m of seed) byId.set(m.id, m);
	for (const m of live) byId.set(m.id, m);
	return [...byId.values()];
}
