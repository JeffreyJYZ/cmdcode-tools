// The OpenDesign lane as the v2 provider editor sees it: register the provider
// and its seed, wake it on a late /connect, and push a live listing over the
// seed. The catalogue itself (seed rows, wire parsing, rates) is
// ./catalogOpenDesign.ts — this module only holds the editor shapes, so neither
// file carries the other's concerns.
import {
	mergeModels,
	type OpenDesignModel,
	modelRecords,
	OPEN_DESIGN_SEED,
} from "./catalogOpenDesign";
import { OPEN_DESIGN_BASE } from "./constants/endpoints";
import {
	OPEN_DESIGN_INTEGRATION_ID,
	OPEN_DESIGN_NAME,
	OPEN_DESIGN_PACKAGE,
	OPEN_DESIGN_PROVIDER_ID,
} from "./constants/providers";

/** The slice of the v2 provider editor this lane touches. Structural, so both
 * the host's branded ids and a test's plain strings fit without a cast hole. */
export type OpenDesignProvider = {
	id: unknown;
	name: string;
	package: string;
	activation: string;
	settings: Record<string, unknown>;
	integrationID?: unknown;
};

export type OpenDesignEditor = {
	update(id: string, fn: (provider: OpenDesignProvider) => void): void;
	models: { set(id: string, models: never): void };
};

/**
 * Register the provider and its seed. A missing key is not an error: the lane
 * registers as `auto` and the host enables it once a credential lands, so a
 * picker with no key still lists the models instead of failing setup.
 */
export function registerProvider(editor: OpenDesignEditor, key: string | undefined): void {
	editor.update(OPEN_DESIGN_PROVIDER_ID, (provider) => {
		// Same gap-fill contract the Command Code lanes use: a non-seed value is
		// the user's own config and is left untouched.
		if (provider.name === (provider.id as unknown as string)) provider.name = OPEN_DESIGN_NAME;
		if (provider.package === "") provider.package = OPEN_DESIGN_PACKAGE;
		provider.activation = key ? "enabled" : "auto";
		provider.settings = { ...provider.settings, baseURL: OPEN_DESIGN_BASE };
		if (key && provider.settings.apiKey === undefined) provider.settings.apiKey = key;
		provider.integrationID ??= OPEN_DESIGN_INTEGRATION_ID;
	});
	editor.models.set(OPEN_DESIGN_PROVIDER_ID, modelRecords(OPEN_DESIGN_SEED) as never);
}

/** Wake the lane once /connect (or the store) holds its credential. */
export function enableProvider(editor: OpenDesignEditor, key: string | undefined): void {
	editor.update(OPEN_DESIGN_PROVIDER_ID, (provider) => {
		provider.activation = "enabled";
		if (key && provider.settings.apiKey === undefined) provider.settings.apiKey = key;
	});
}

/** Push a live listing over the seed. Safe to re-apply: the union keeps every
 * seeded id, so a shorter listing never removes a row. */
export function applyModels(editor: OpenDesignEditor, live: readonly OpenDesignModel[]): void {
	editor.models.set(
		OPEN_DESIGN_PROVIDER_ID,
		modelRecords(mergeModels(OPEN_DESIGN_SEED, live)) as never,
	);
}
