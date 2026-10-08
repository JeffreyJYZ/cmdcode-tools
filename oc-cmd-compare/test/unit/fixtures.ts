import type { CatalogEntry, PlanInfo, ProviderId, Workload } from "~/types.ts";

export const workload: Workload = {
	input: 1_000,
	cacheRead: 50_000,
	output: 200,
	reasoning: 0,
	cacheWrite: 0,
};

/** Both sides on the same fixed workload, for tests that measure no shape. */
export const workloads: Record<ProviderId, Workload> = {
	"oc-go": workload,
	cc: workload,
};

export const ccPlan: PlanInfo = {
	provider: "cc",
	id: "goat",
	label: "GOAT",
	price: 10,
	credits: 70,
	fiveHour: 14,
	weekly: 35,
};

export const ocPlan: PlanInfo = {
	provider: "oc-go",
	id: "go",
	label: "Go",
	price: 10,
	credits: 100,
	fiveHour: null,
	weekly: null,
};

export function entry(overrides: Partial<CatalogEntry>): CatalogEntry {
	return {
		provider: "cc",
		plan: "GOAT",
		key: "m",
		name: "M",
		pricing: { input: 1, output: 1, cacheRead: 0, cacheWrite: null },
		allowance: 20,
		...overrides,
	};
}

import type { CompareRow, EntryMetrics } from "~/types.ts";

export function metric(payPerRequest: number): EntryMetrics {
	return {
		provider: "cc",
		plan: "GOAT",
		pricing: { input: 1, output: 1, cacheRead: 0, cacheWrite: null },
		allowance: 20,
		costPerRequest: 1,
		requestsPerMonth: 1,
		requestsPerFiveHour: 0.2,
		requestsPerWeek: 0.5,
		payPerRequest,
		multiplier: 1,
		ability: null,
		tps: null,
		index: 0,
		valueIndex: null,
		free: payPerRequest === 0,
	};
}

export function row(key: string, oc?: number, cc?: number): CompareRow {
	return {
		key,
		name: key,
		oc: oc === undefined ? undefined : metric(oc),
		cc: cc === undefined ? undefined : metric(cc),
	};
}
