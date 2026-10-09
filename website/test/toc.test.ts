import { expect, test } from "bun:test";
import { extractToc } from "@/lib/toc";

test("extracts H2/H3 headings with github-slugger ids", () => {
	expect(extractToc("# T\n## One\n### A B\n## Two")).toEqual([
		{ depth: 2, id: "one", text: "One" },
		{ depth: 3, id: "a-b", text: "A B" },
		{ depth: 2, id: "two", text: "Two" },
	]);
});

test("ignores headings inside fenced code blocks", () => {
	const md =
		"# T\n\n## Real\n\n```sh\n## Not a heading\necho hi\n```\n\n### Also real\n";
	expect(extractToc(md)).toEqual([
		{ depth: 2, id: "real", text: "Real" },
		{ depth: 3, id: "also-real", text: "Also real" },
	]);
});
