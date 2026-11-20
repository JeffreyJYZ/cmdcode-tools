import { describe, expect, test } from "bun:test";
import { envelope } from "#~/cli/output.ts";
import { toOptions } from "#~/cli/map.ts";
import { parseArgv } from "#~/cli/parse.ts";
import { run } from "#~/cli/run.ts";
import { catalogue, captureConsole, model } from "./fixture.ts";

const CONTRACT_KEYS = [
	"schema",
	"sources",
	"indexVersion",
	"fetchedAt",
	"stale",
	"notes",
	"total",
	"count",
	"models",
];

const MODELS = [
	model({ slug: "glm-5-3", name: "GLM 5.3", intelligenceIndex: 60, raw: { upstream: true } }),
	model({ slug: "kimi-k3", name: "Kimi K3", intelligenceIndex: 50 }),
	model({ slug: "unscored-one", name: "Unscored One" }),
];

const CATALOGUE = catalogue(MODELS, { notes: ["api: quota spent"] });
const options = (...argv: string[]) => toOptions(parseArgv(argv));

describe("--json output", () => {
	test("prints exactly the contract object and nothing else", async () => {
		const { out, restore } = captureConsole();
		try {
			const code = await run(["--json"], { loadCatalogue: async () => CATALOGUE });
			expect(code).toBe(0);
			expect(out).toHaveLength(1);
			const payload = JSON.parse(out[0] as string) as Record<string, unknown>;
			expect(Object.keys(payload)).toEqual(CONTRACT_KEYS);
			expect(payload.schema).toBe("aa-models/1");
			expect(payload.sources).toEqual(["manifest"]);
			expect(payload.indexVersion).toBe("v5.0.1");
			expect(payload.total).toBe(3);
			expect(payload.count).toBe(3);
			expect(payload.notes).toContain("api: quota spent");
		} finally {
			restore();
		}
	});

	test("total stays the catalogue size while count follows the filters", async () => {
		const { out, restore } = captureConsole();
		try {
			await run(["--json", "--scored"], { loadCatalogue: async () => CATALOGUE });
			const payload = JSON.parse(out[0] as string) as Record<string, unknown>;
			expect(payload.total).toBe(3);
			expect(payload.count).toBe(2);
		} finally {
			restore();
		}
	});

	test("raw is dropped unless --raw is passed", async () => {
		const stripped = envelope(CATALOGUE, MODELS, options("--json"));
		expect("raw" in (stripped.models[0] as object)).toBe(false);
		const kept = envelope(CATALOGUE, MODELS, options("--json", "--raw"));
		expect(kept.models[0]?.raw).toEqual({ upstream: true });
	});

	test("an unknown --where path becomes a note, not a silent empty table", async () => {
		const { out, restore } = captureConsole();
		try {
			await run(["--json", "--where", "nope.missing=1"], {
				loadCatalogue: async () => CATALOGUE,
			});
			const payload = JSON.parse(out[0] as string) as { notes: string[] };
			expect(payload.notes.join("\n")).toContain(
				"--where nope.missing: no model publishes this field",
			);
		} finally {
			restore();
		}
	});
});
