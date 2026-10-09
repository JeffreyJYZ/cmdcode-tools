import { describe, expect, test } from "bun:test";
import { extractCatalog, parseRoleRows } from "#~/data/scrape/index.ts";

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
