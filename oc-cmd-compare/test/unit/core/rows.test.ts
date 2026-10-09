import { describe, expect, test } from "bun:test";
import { buildRows } from "#~/cli/engine/index.ts";
import { normalizeKey } from "#~/keys.ts";
import { ccPlan, entry, ocPlan, workloads } from "../fixtures.ts";

describe("buildRows", () => {
	test("joins both catalogs on the canonical key", () => {
		const oc = entry({
			provider: "oc-go",
			plan: "Go",
			key: "kimi k3",
			name: "Kimi K3",
		});
		const cc = entry({
			provider: "cc",
			plan: "GOAT",
			key: "kimi k3",
			name: "Kimi K3",
		});
		const only = entry({
			provider: "cc",
			plan: "GOAT",
			key: "solo",
			name: "Solo",
		});
		const rows = buildRows([oc], [cc, only], ocPlan, ccPlan, workloads);
		const joined = rows.find((r) => r.key === "kimi k3");
		expect(joined?.oc).toBeDefined();
		expect(joined?.cc).toBeDefined();
		const solo = rows.find((r) => r.key === "solo");
		expect(solo?.oc).toBeUndefined();
		expect(solo?.cc).toBeDefined();
	});

	test("a free '… Free' variant merges with its base-keyed counterpart", () => {
		// The OC docs name it "Step 5 Preview Free", CommandCode "Step 5 Preview";
		// normalizeKey must collapse them so this is one row, not two.
		const oc = entry({
			provider: "oc-go",
			plan: "Go",
			key: normalizeKey("Step 5 Preview Free"),
			name: "Step 5 Preview Free",
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			allowance: 0,
		});
		const cc = entry({
			key: normalizeKey("Step 5 Preview"),
			name: "Step 5 Preview",
		});
		const rows = buildRows([oc], [cc], ocPlan, ccPlan, workloads);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.key).toBe("step5preview");
		expect(rows[0]?.oc?.free).toBe(true);
		expect(rows[0]?.cc).toBeDefined();
	});

	test("each side is priced on its own workload", () => {
		const pricing = { input: 1, output: 0, cacheRead: 0, cacheWrite: null };
		const oc = entry({
			provider: "oc-go",
			plan: "Go",
			key: "m",
			name: "M",
			pricing,
		});
		const cc = entry({
			provider: "cc",
			plan: "GOAT",
			key: "m",
			name: "M",
			pricing,
		});
		const rows = buildRows([oc], [cc], ocPlan, ccPlan, {
			"oc-go": {
				input: 1_000,
				cacheRead: 0,
				output: 0,
				reasoning: 0,
				cacheWrite: 0,
			},
			cc: {
				input: 10_000,
				cacheRead: 0,
				output: 0,
				reasoning: 0,
				cacheWrite: 0,
			},
		});
		const joined = rows.find((r) => r.key === "m");
		expect(joined?.oc?.costPerRequest).toBeCloseTo(1_000 / 1e6, 12);
		expect(joined?.cc?.costPerRequest).toBeCloseTo(10_000 / 1e6, 12);
	});
});
