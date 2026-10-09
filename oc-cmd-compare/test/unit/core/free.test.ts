import { describe, expect, test } from "bun:test";
import { buildMetrics } from "#~/cli/engine/index.ts";
import { extractCatalog, parseTables } from "#~/data/scrape/index.ts";
import { ocPlan, workloads } from "../fixtures.ts";

// A free Go model: the rate cells read "Free" and the monthly-limit cell reads
// "Unlimited" (with a footnote), not a $ figure.
const FREE_FIXTURE = `
<table>
	<tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
	<tr><td>Step 5 Preview Free</td><td>Free</td><td>Free</td><td>Free</td><td>-</td><td><strong>Unlimited</strong><br><small>limited time</small></td></tr>
</table>`;

async function freeEntries() {
	const tables = await parseTables(FREE_FIXTURE);
	return extractCatalog(tables, {
		provider: "oc-go",
		plan: "Go",
		creditHeader: /monthly limit/i,
	});
}

describe("OpenCode Go free (Unlimited) rows", () => {
	test("an Unlimited limit cell yields a free, aliased entry", async () => {
		const entries = await freeEntries();
		expect(entries).toHaveLength(1);
		const [entry] = entries;
		// The "… Free" suffix collapses onto the base key so the free variant
		// merges with its counterpart instead of adding a second row.
		expect(entry?.key).toBe("step5preview");
		// allowance is meaningless once cost is 0 — 0 keeps it out of the plan's
		// summed credits and marks the entry free.
		expect(entry?.allowance).toBe(0);
		expect(entry?.pricing).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
	});

	test("a free entry is unbounded and scores 100", async () => {
		const entries = await freeEntries();
		const [m] = buildMetrics(
			entries,
			new Map([["oc-go", ocPlan]]),
			workloads,
		);
		expect(m?.free).toBe(true);
		expect(m?.requestsPerMonth).toBe(Number.POSITIVE_INFINITY);
		expect(m?.requestsPerFiveHour).toBe(Number.POSITIVE_INFINITY);
		expect(m?.payPerRequest).toBe(0);
		expect(m?.index).toBe(100);
	});
});
