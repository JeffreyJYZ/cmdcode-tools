import { describe, expect, test } from "bun:test";
import { OC_PLANS } from "#~/constants/sources.ts";
import {
	extractCatalog,
	parseRoleRows,
	parseTabTables,
	type TabTable,
} from "#~/data/scrape/index.ts";
import { ocGoPlan } from "#~/data/sources/opencode.ts";

describe("parseRoleRows (div grid model lists)", () => {
	const GRID_FIXTURE = `
		<div role="row"><div>Model</div><div>Context</div><div>Input<span>/M</span></div><div>Output<span>/M</span></div><div>Cache Read</div><div>Cache Write</div><div>Caps</div></div>
		<div role="row"><div>Kimi K3</div><div>1M</div><div>$3.00</div><div>$15.00</div><div>$0.30</div><div>—</div><div>+1</div></div>
		<div role="row"><div>Laguna S 2.1</div><div>256K</div><div>Free</div><div>Free</div><div>Free</div><div>—</div><div></div></div>
	`;

	test("reads header and rows, applying a flat allowance", async () => {
		const tables = await parseRoleRows(GRID_FIXTURE);
		expect(tables).toHaveLength(1);
		const entries = extractCatalog(tables, {
			provider: "cc",
			plan: "Go",
			defaultAllowance: 10,
		});
		const byKey = new Map(entries.map((e) => [e.key, e]));
		expect(byKey.get("kimik3")?.allowance).toBe(10);
		expect(byKey.get("kimik3")?.pricing.input).toBe(3);
		expect(byKey.get("kimik3")?.pricing.cacheWrite).toBeNull();
		// Free model rates come through as zero, not the flat allowance.
		expect(byKey.get("lagunas21")?.pricing.input).toBe(0);
		expect(byKey.get("lagunas21")?.allowance).toBe(10);
	});
});

// Both Go plans render the same priced table (identical headers and rates)
// behind a `<Tabs syncKey="go-plan">`, so the tab label is the only
// discriminator. A second, equally-synced tab block lists request-count
// estimates with no rates; it must never be selected.
const TABS_FIXTURE = `
<starlight-tabs data-sync-key="go-plan">
	<ul role="tablist">
		<li role="presentation"><a role="tab" href="#tab-panel-0" aria-selected="true">Go</a></li>
		<li role="presentation"><a role="tab" href="#tab-panel-1" aria-selected="false">Go Plus</a></li>
	</ul>
	<div id="tab-panel-0" role="tabpanel">
		<table>
			<tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
			<tr><td>GLM-5.3-Flash</td><td>$0.15</td><td>$0.50</td><td>$0.03</td><td>-</td><td><strong>$60</strong></td></tr>
		</table>
	</div>
	<div id="tab-panel-1" role="tabpanel" hidden>
		<table>
			<tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
			<tr><td>GLM-5.3-Flash</td><td>$0.15</td><td>$0.50</td><td>$0.03</td><td>-</td><td><strong>$180</strong></td></tr>
		</table>
	</div>
</starlight-tabs>
<starlight-tabs data-sync-key="go-plan">
	<ul role="tablist">
		<li role="presentation"><a role="tab" href="#tab-panel-2" aria-selected="true">Go</a></li>
		<li role="presentation"><a role="tab" href="#tab-panel-3" aria-selected="false">Go Plus</a></li>
	</ul>
	<div id="tab-panel-2" role="tabpanel">
		<table>
			<tr><th>Model</th><th>Requests per 5 hours</th><th>Requests per week</th><th>Requests per month</th></tr>
			<tr><td>GLM-5.3-Flash</td><td>120</td><td>600</td><td>1200</td></tr>
		</table>
	</div>
</starlight-tabs>`;

/** Pull a plan's priced table by tab label, exactly as `loadOcGoCatalog` does. */
function select(tables: TabTable[], label: string) {
	return extractCatalog(
		tables.filter((t) => t.label === label).map((t) => t.table),
		{ provider: "oc-go", plan: label, creditHeader: /monthly limit/i },
	);
}

describe("OpenCode Go vs Go Plus tab selection", () => {
	test("the tab label selects the plan's priced table", async () => {
		const tables = await parseTabTables(TABS_FIXTURE);
		const go = select(tables, OC_PLANS.go?.label ?? "");
		const plus = select(tables, OC_PLANS["go-plus"]?.label ?? "");
		expect(go).toHaveLength(1);
		expect(plus).toHaveLength(1);
		expect(go[0]?.allowance).toBe(60);
		expect(plus[0]?.allowance).toBe(180);
		// Shared token rates across the two plans.
		expect(go[0]?.pricing).toEqual(plus[0]?.pricing);
		expect(go[0]?.plan).toBe("Go");
		expect(plus[0]?.plan).toBe("Go Plus");
	});

	test("the request-count tab block is never selected", async () => {
		const tables = await parseTabTables(TABS_FIXTURE);
		// Its identically-labelled table has no priced columns, so a plan
		// selection yields only the priced one.
		expect(select(tables, "Go")).toHaveLength(1);
	});

	test("plans carry tab labels and monthly prices", () => {
		expect(OC_PLANS.go).toEqual({ label: "Go", price: 10 });
		expect(OC_PLANS["go-plus"]).toEqual({ label: "Go Plus", price: 40 });
	});

	test("the selected plan drives the plan info", () => {
		const entries = [
			{
				provider: "oc-go" as const,
				plan: "Go Plus",
				key: "glm53flash",
				name: "GLM-5.3-Flash",
				pricing: {
					input: 0.15,
					output: 0.5,
					cacheRead: 0.03,
					cacheWrite: null,
				},
				allowance: 180,
			},
		];
		const plus = ocGoPlan(entries, "go-plus");
		expect(plus.id).toBe("go-plus");
		expect(plus.label).toBe("Go Plus");
		expect(plus.price).toBe(40);
		expect(plus.credits).toBe(180);
		expect(() => ocGoPlan(entries, "nope")).toThrow(
			/unknown OpenCode plan/,
		);
	});
});
