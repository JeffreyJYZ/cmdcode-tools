export type ProviderId = "oc-go" | "cc" | "custom";

export interface RateEntry {
	key: string;
	model: string;
	provider: ProviderId;
	/** Plan label as the provider writes it: Go, GOAT, Pro, Max 20x — or `custom`. */
	plan: string;
	input: number;
	output: number;
	/** Null when the model publishes no cache-read rate; bill it as input. */
	cacheRead: number | null;
	cacheWrite: number | null;
	/** Dollars of list-rate spend the plan grants this model per month. */
	allowance: number;
	/** Share of the allowance the plan opens per five hours, and per week. */
	ratio5h: number | null;
	ratioWeek: number | null;
	free: boolean;
}

export interface MpcSide {
	provider?: string;
	plan?: string;
	pricing?: {
		input?: number;
		output?: number;
		cacheRead?: number | null;
		cacheWrite?: number | null;
	} | null;
	allowance?: number | null;
	requestsPerMonth?: number;
	requestsPerFiveHour?: number;
	requestsPerWeek?: number;
	free?: boolean;
}

export interface MpcJson {
	plans?: Record<
		string,
		{
			label?: string;
			credits?: number;
			fiveHour?: number | null;
			weekly?: number | null;
		}
	>;
	rows?: Array<{
		key?: string;
		name?: string;
		oc?: MpcSide | null;
		cc?: MpcSide | null;
	}>;
}

export interface CustomRates {
	label: string;
	input: number;
	output: number;
	cacheRead: number | null;
	cacheWrite: number | null;
	budget: number;
	cap5h: number | null;
	capWeek: number | null;
}

/** Full provider name, for the JSON payload's consumers. */
export function providerName(provider: ProviderId): string {
	if (provider === "oc-go") return "OpenCode";
	return provider === "cc" ? "CommandCode" : "custom";
}

/** Column-width provider tag. */
export function shortProvider(provider: ProviderId): string {
	if (provider === "oc-go") return "OC";
	return provider === "cc" ? "CC" : "custom";
}

/** e.g. "OC Go", "CC GOAT". */
export function planLabel(entry: RateEntry): string {
	return entry.provider === "custom"
		? "custom"
		: `${shortProvider(entry.provider)} ${entry.plan}`.trim();
}

export function customEntry(custom: CustomRates): RateEntry {
	const share = (cap: number | null): number | null =>
		cap !== null && custom.budget > 0 ? cap / custom.budget : null;
	return {
		key: "custom",
		model: custom.label,
		provider: "custom",
		plan: "custom",
		input: custom.input,
		output: custom.output,
		cacheRead: custom.cacheRead,
		cacheWrite: custom.cacheWrite,
		allowance: custom.budget,
		ratio5h: share(custom.cap5h),
		ratioWeek: share(custom.capWeek),
		free: false,
	};
}
