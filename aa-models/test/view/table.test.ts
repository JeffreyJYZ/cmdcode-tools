import { describe, expect, test } from "bun:test";
import { DEFAULT_COLUMNS, columnIds, pickColumns } from "#~/view/columns.ts";
import { renderTable } from "#~/view/table.ts";
import { FIXTURE, stripSgr } from "./fixture.ts";

describe("default table", () => {
	test("prints the declared default columns, not every column", () => {
		const { text } = renderTable(FIXTURE, { color: false });
		const [header, first] = text.split("\n");
		expect(header).toContain("NAME");
		expect(header).toContain("CREATOR");
		expect(header).toContain("INTEL");
		expect(header).not.toContain("SLUG");
		expect(first).toContain("GPT-6");
		expect(first).toContain("72.4");
		expect(first).toContain("200K");
		expect(first).toContain("$2.5");
	});

	test("a null renders as an em dash, never as 0", () => {
		const { text } = renderTable(FIXTURE, { color: false, columns: ["name", "open"] });
		const row = text.split("\n").find((line) => line.startsWith("Mystery 1")) ?? "";
		expect(row.trimEnd().endsWith("—")).toBe(true);
		expect(row).not.toContain("0");
	});

	test("the registry keeps the default set to real ids", () => {
		const ids = columnIds();
		for (const id of DEFAULT_COLUMNS) expect(ids).toContain(id);
		expect(() => pickColumns(["nope"])).toThrow(/unknown column/);
	});

	test("rows keep their order and every row is printed", () => {
		const { text } = renderTable(FIXTURE, { color: false, columns: ["name"] });
		expect(text.split("\n")).toEqual(["NAME", ...FIXTURE.map((model) => model.name)]);
	});
});

describe("width trimming", () => {
	test("a narrow table drops the lowest-priority column and says so", () => {
		const wide = renderTable(FIXTURE, { color: false });
		const width = Math.max(...wide.text.split("\n").map((line) => line.length));
		const narrow = renderTable(FIXTURE, { color: false, width: width - 1 });
		expect(narrow.dropped).toEqual(["released"]);
		expect(narrow.text).toContain("dropped for width: released");
		expect(narrow.text).not.toContain("RELEASED");
	});

	test("an explicit --columns list is never dropped", () => {
		const ids = ["name", "released"];
		const narrow = renderTable(FIXTURE, { color: false, columns: ids, width: 4 });
		expect(narrow.dropped).toEqual([]);
		expect(narrow.text).toContain("RELEASED");
	});
});

describe("row cap", () => {
	test("--rows keeps the newest rows and counts the rest", () => {
		const capped = renderTable(FIXTURE, { color: false, columns: ["name"], rows: 2 });
		expect(capped.hidden).toBe(3);
		expect(capped.text).toContain("… 3 more");
		expect(capped.text.split("\n")).toHaveLength(4);
	});

	test("rows 0 means every row", () => {
		const all = renderTable(FIXTURE, { color: false, columns: ["name"], rows: 0 });
		expect(all.hidden).toBe(0);
		expect(all.text).toContain("Acme Mini");
	});
});

describe("colour", () => {
	test("colour off is byte-identical to the coloured text minus its escapes", () => {
		const plain = renderTable(FIXTURE, { color: false });
		const coloured = renderTable(FIXTURE, { color: true });
		expect(coloured.text).not.toBe(plain.text);
		expect(stripSgr(coloured.text)).toBe(plain.text);
	});

	test("a missing value is dim, a favourable one green", () => {
		const { text } = renderTable(FIXTURE, { color: true, columns: ["name", "open"] });
		expect(text).toContain("\x1b[2m—");
		expect(text).toContain("\x1b[32mopen");
	});
});
