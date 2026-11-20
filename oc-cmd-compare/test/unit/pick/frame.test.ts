import { beforeEach, describe, expect, test } from "bun:test";
import { detailLines, frameLines } from "#~/pick/frame.ts";
import { fitLine } from "#~/pick/text.ts";
import type { CompareRow } from "#~/types.ts";
import { setColor } from "#~/view/render.ts";
import type { ReportMeta } from "#~/view/schema.ts";
import { ccPlan, ocPlan, row, workloads } from "../fixtures.ts";

const meta: ReportMeta = { ocPlan, ccPlan, workloads };

/** CommandCode only, so the OpenCode cells must read `—`. */
const ccOnly: CompareRow = row("glm-5.3", undefined, 2);
const rows: CompareRow[] = [row("deepseek v4.1 flash", 1, 2), ccOnly];

const frame = (overrides: Partial<Parameters<typeof frameLines>[0]> = {}) =>
	frameLines({
		query: "",
		rows,
		total: rows.length,
		selected: 0,
		width: 80,
		height: 24,
		detail: [],
		...overrides,
	});

/** No colour: assertions are on visible text, not on SGR guesses. */
beforeEach(() => setColor(false));

describe("frameLines", () => {
	test("header, query line, rule, then the selected row marked", () => {
		const lines = frame();
		expect(lines[0]).toBe("mpc pick · 2 of 2 models");
		expect(lines[1]).toBe("query: █");
		expect(lines[2]).toBe("─".repeat(80));
		expect(lines[3]?.startsWith("▸ ")).toBe(true);
		expect(lines[3]).toContain("deepseek v4.1 flash");
		expect(lines[4]?.startsWith("  ")).toBe(true);
		expect(lines[4]).toContain("glm-5.3");
		expect(lines.at(-1)).toContain("enter print");
	});

	test("a side the row does not carry reads — exactly like the table", () => {
		const line = frame({ selected: 0, rows: [ccOnly], total: 1 }).at(3) ?? "";
		expect(line).toContain("—");
		expect(line).toContain("CC only");
	});

	test("every line fits the width at 80 and 120 columns", () => {
		for (const width of [80, 120]) {
			for (const line of frame({ width })) {
				expect(line.length).toBeLessThanOrEqual(width);
			}
		}
	});

	test("a long name clips with … when narrow and stays whole when wide", () => {
		const long: CompareRow = { key: "long", name: `model ${"x".repeat(55)} end` };
		const narrow = frame({ width: 80, rows: [long], total: 1 }).at(3) ?? "";
		const wide = frame({ width: 120, rows: [long], total: 1 }).at(3) ?? "";
		expect(narrow).toContain("…");
		expect(wide).toContain(long.name);
		expect(wide).not.toContain("…");
	});

	test("the detail block sits under its own rule and is counted in the height", () => {
		const lines = frame({ detail: ["MODEL", "rates"], height: 12 });
		expect(lines.length).toBeLessThanOrEqual(12);
		const at = lines.indexOf("MODEL");
		expect(at).toBeGreaterThan(0);
		expect(lines[at - 1]).toBe("─".repeat(80));
	});

	test("a query with no hit says so instead of drawing nothing", () => {
		const lines = frame({ query: "zzz", rows: [], total: 2 });
		expect(lines.some((line) => line.includes('no model matches "zzz"'))).toBe(true);
	});

	test("a selection deep in the list scrolls the window around it", () => {
		const many = Array.from({ length: 40 }, (_, i) =>
			row(`model-${String(i).padStart(2, "0")}`),
		);
		const lines = frame({ rows: many, total: 40, selected: 30, height: 14, detail: [] });
		const marked = lines.find((line) => line.startsWith("▸ ")) ?? "";
		expect(marked).toContain("model-30");
		expect(lines.length).toBeLessThanOrEqual(14);
	});

	test("the query is echoed, cursor included", () => {
		expect(frame({ query: "kimi" })[1]).toBe("query: kimi█");
	});
});

describe("detailLines", () => {
	test("is the table renderer with every column, without the footer", () => {
		const lines = detailLines(rows[0] as CompareRow, meta, 200);
		const text = lines.join("\n");
		expect(text).toContain("MODEL");
		expect(text).toContain("deepseek v4.1 flash");
		expect(text).not.toContain("head-to-head");
		expect(text).not.toContain("legend");
	});

	test("drops columns to fit a narrow terminal", () => {
		const narrow = detailLines(rows[0] as CompareRow, meta, 80);
		const wide = detailLines(rows[0] as CompareRow, meta, 200);
		expect(narrow[0]?.length ?? 0).toBeLessThan(wide[0]?.length ?? 0);
	});

	test("a clipped coloured line loses its colour instead of bleeding it", () => {
		setColor(true);
		const lines = detailLines(rows[0] as CompareRow, meta, 200);
		const row = lines.find((line) => line.includes("deepseek")) ?? "";
		setColor(false);
		expect(row).toContain("\u001b[");
		const cut = fitLine(row, 12);
		expect(cut).not.toContain("\u001b");
		expect(cut).toBe("deepseek v4…");
	});
});
