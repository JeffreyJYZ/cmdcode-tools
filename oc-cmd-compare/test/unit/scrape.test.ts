import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OC_PLANS } from "#~/constants/sources.ts";
import {
	extractCatalog,
	parseOcGoModels,
	parseRoleRows,
	parseTabTables,
} from "#~/data/scrape/index.ts";
import { ocGoPlan } from "#~/data/sources/opencode.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const MODEL_FIXTURE = "oc-go-models.json";
const DOCS_FIXTURE = "oc-go-docs.html";
const goPayload = JSON.parse(readFileSync(new URL(MODEL_FIXTURE, FIXTURES), "utf8"));

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

function goPlan(id: string) {
	const def = OC_PLANS[id];
	if (!def) throw new Error(`missing OpenCode plan: ${id}`);
	return def;
}

describe("OpenCode Go catalog from /zen/go/v1/models", () => {
	const go = () => parseOcGoModels(goPayload, goPlan("go"));
	const plus = () => parseOcGoModels(goPayload, goPlan("go-plus"));
	const byKey = (entries: ReturnType<typeof go>) => new Map(entries.map((e) => [e.key, e]));

	test(`rates, monthly limits and keys parse from ${MODEL_FIXTURE}`, () => {
		const entries = go();
		expect(entries, MODEL_FIXTURE).toHaveLength(6);
		const by = byKey(entries);
		// The id, not the bake-dated display name, is the cross-provider key.
		const ds = by.get("deepseekv41flash");
		expect(ds, MODEL_FIXTURE).toBeDefined();
		expect(ds?.name).toBe("DeepSeek V4.1 Flash 1017");
		expect(ds?.pricing, MODEL_FIXTURE).toEqual({
			input: 0.15,
			output: 0.6,
			cacheRead: 0.003,
			cacheWrite: null,
		});
		expect(ds?.allowance, MODEL_FIXTURE).toBe(100);
		expect(by.get("kimik3")?.pricing.cacheWrite).toBe(3);
		expect(by.get("glm53flash")?.allowance).toBe(60);
	});

	test(`the plan's usageKey picks its monthly limit (${MODEL_FIXTURE})`, () => {
		const goBy = byKey(go());
		const plusBy = byKey(plus());
		expect(plusBy.get("glm53flash")?.allowance, MODEL_FIXTURE).toBe(180);
		expect(plusBy.get("deepseekv41flash")?.allowance, MODEL_FIXTURE).toBe(200);
		// Rates are shared; only the allowance differs.
		expect(plusBy.get("kimik3")?.pricing, MODEL_FIXTURE).toEqual(goBy.get("kimik3")?.pricing);
		expect(plusBy.get("kimik3")?.plan, MODEL_FIXTURE).toBe("Go Plus");
	});

	test(`TTL-map cache write and free models parse (${MODEL_FIXTURE})`, () => {
		const by = byKey(go());
		expect(by.get("gpt6luna")?.pricing.cacheWrite, MODEL_FIXTURE).toBe(0.125);
		for (const free of ["beam10", "hy4flash"]) {
			expect(by.get(free)?.allowance, MODEL_FIXTURE).toBe(0);
			expect(by.get(free)?.pricing, MODEL_FIXTURE).toEqual({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			});
		}
	});

	test(`malformed payload yields no rows (${MODEL_FIXTURE})`, () => {
		expect(parseOcGoModels({ nope: true }, goPlan("go"))).toEqual([]);
	});

	test(`the docs HTML has no priced table to scrape (${DOCS_FIXTURE})`, async () => {
		const raw = readFileSync(new URL(DOCS_FIXTURE, FIXTURES), "utf8");
		// The fixture's leading comment mentions the markers it documents as gone;
		// strip comments so the assertion checks rendered markup only.
		const html = raw.replace(/<!--[\s\S]*?-->/g, "");
		const tables = await parseTabTables(html);
		// prove the role="tab" markers really are gone in the saved page
		expect(html, DOCS_FIXTURE).not.toContain('role="tab"');
		expect(tables, DOCS_FIXTURE).toHaveLength(4);
		expect(
			tables.every((t) => t.label === ""),
			DOCS_FIXTURE,
		).toBe(true);
		const priced = extractCatalog(
			tables.map((t) => t.table),
			{ provider: "oc-go", plan: "Go", creditHeader: /monthly limit/i },
		);
		expect(priced, DOCS_FIXTURE).toHaveLength(0);
	});

	test("plans carry labels, prices and JSON usage keys", () => {
		expect(OC_PLANS.go).toEqual({ label: "Go", price: 10, usageKey: "go" });
		expect(OC_PLANS["go-plus"]).toEqual({
			label: "Go Plus",
			price: 40,
			usageKey: "go-plus",
		});
	});

	test("the selected plan drives the plan info", () => {
		const entries = [
			{
				provider: "oc-go" as const,
				plan: "Go Plus",
				key: "glm53flash",
				name: "GLM-5.3-Flash",
				pricing: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: null },
				allowance: 180,
			},
		];
		const plus = ocGoPlan(entries, "go-plus");
		expect(plus.id).toBe("go-plus");
		expect(plus.label).toBe("Go Plus");
		expect(plus.price).toBe(40);
		expect(plus.credits).toBe(180);
		expect(() => ocGoPlan(entries, "nope")).toThrow(/unknown OpenCode plan/);
	});
});
