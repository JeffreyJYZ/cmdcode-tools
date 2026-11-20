import { describe, expect, test } from "bun:test";
import { fieldRows, runModel } from "#~/cli/commands.ts";
import { toOptions } from "#~/cli/map.ts";
import { parseArgv } from "#~/cli/parse.ts";
import { catalogue, captureConsole, model } from "./fixture.ts";

const MODELS = [
	model({
		slug: "glm-5-3",
		name: "GLM 5.3",
		creator: "Z.ai",
		intelligenceIndex: 60,
		price: { input: 0.6, output: 2.2, blended: 1.4 },
		keys: ["glm-5-3", "glm-5-3-0825", "glm53"],
	}),
	model({ slug: "kimi-k3", name: "Kimi K3", creator: "Moonshot", intelligenceIndex: 50 }),
];

const CATALOGUE = catalogue(MODELS);
const options = (...argv: string[]) => toOptions(parseArgv(argv));

describe("aam model", () => {
	test("an exact slug resolves even when the query filters nothing else", () => {
		const { out, restore } = captureConsole();
		try {
			const code = runModel(CATALOGUE, options("model", "glm53"), []);
			expect(code).toBe(0);
			expect(out.join("\n")).toContain("GLM 5.3");
		} finally {
			restore();
		}
	});

	test("several matches list the candidates and exit 1", () => {
		const { err, restore } = captureConsole();
		try {
			const code = runModel(CATALOGUE, options("model", "kimi"), MODELS);
			expect(code).toBe(1);
			expect(err.join("\n")).toContain("matches 2 models");
		} finally {
			restore();
		}
	});

	test("no match exits 1 naming the query", () => {
		const { err, restore } = captureConsole();
		try {
			expect(runModel(CATALOGUE, options("model", "absent"), [])).toBe(1);
			expect(err.join("\n")).toContain('no model matches "absent"');
		} finally {
			restore();
		}
	});
});

describe("aam fields", () => {
	test("counts models per dot-path", () => {
		const rows = fieldRows(MODELS);
		const byPath = new Map(rows.map((row) => [row.path, row.count]));
		expect(byPath.get("intelligenceIndex")).toBe(2);
		expect(byPath.get("price.input")).toBe(1);
		expect(byPath.get("slug")).toBe(2);
		// `raw` is a debug payload, never a discoverable field.
		expect([...byPath.keys()].some((path) => path.startsWith("raw"))).toBe(false);
	});
});
