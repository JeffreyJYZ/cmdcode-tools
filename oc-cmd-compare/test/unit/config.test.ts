import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBag } from "#~/cli/config.ts";
import { parseArgs } from "#~/cli/parse/cac.ts";

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "mpc-test-"));
}

describe("config file", () => {
	test("config supplies values, CLI overrides it", async () => {
		const dir = scratch();
		const file = join(dir, "config.json");
		writeFileSync(file, JSON.stringify({ ccPlan: "pro", metric: "cost" }));
		const fromConfig = await resolveBag(["--config", file]);
		expect(fromConfig.ccPlan).toBe("pro");
		expect(fromConfig.metric).toBe("cost");
		const overridden = await resolveBag([
			"--config",
			file,
			"--cc-plan",
			"max10",
		]);
		expect(overridden.ccPlan).toBe("max10");
		expect(overridden.metric).toBe("cost");
	});

	test("plugins sit under the config and over the defaults", async () => {
		const dir = scratch();
		const plugin = join(dir, "plugin.ts");
		writeFileSync(
			plugin,
			'export default { ccPlan: "max20", metric: "req", width: 100 };\n',
		);
		const file = join(dir, "config.json");
		writeFileSync(
			file,
			JSON.stringify({ plugins: ["./plugin.ts"], metric: "cost" }),
		);
		const bag = await resolveBag(["--config", file]);
		expect(bag.ccPlan).toBe("max20"); // plugin only
		expect(bag.metric).toBe("cost"); // config beats plugin
		expect(bag.width).toBe(100); // plugin only
	});

	test("--no-config skips file and plugins", async () => {
		const bag = await resolveBag(["--no-config"]);
		expect(bag.config).toBe(false);
	});
});

describe("parseArgs defaults", () => {
	test("weights and thresholds have defaults", () => {
		const o = parseArgs([]);
		expect(o.scale).toBe("log");
		expect(o.format).toBe("table");
		expect(o.colorMode).toBe("auto");
		expect(o.costThresholds).toEqual([30, 60]);
		expect(o.valThresholds).toEqual([40, 70]);
	});

	test("weights parse from comma lists", () => {
		const o = parseArgs([
			"--val-weights",
			"1,0,0,0,0",
			"--window",
			"0.3,0.6",
		]);
		expect(o.valWeights).toEqual([1, 0, 0, 0, 0]);
		expect(o.window).toEqual([0.3, 0.6]);
	});

	test("format and colour mode validate", () => {
		expect(() => parseArgs(["--format", "xml"])).toThrow();
		expect(parseArgs(["--color", "never"]).colorMode).toBe("never");
		expect(parseArgs(["--color", "always"]).colorMode).toBe("always");
		expect(parseArgs(["--format", "csv"]).format).toBe("csv");
	});
});
