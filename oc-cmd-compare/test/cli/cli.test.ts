import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBag } from "#~/cli/config.ts";
import { parseArgs, run } from "#~/cli/run.ts";
import { BENCH_DEFAULT } from "#~/constants/cli.ts";
import { SHAPE_AUTO, SHAPE_MEASURED, SHAPE_OFF } from "#~/constants/shape.ts";

describe("parseArgs", () => {
	test("defaults", () => {
		const o = parseArgs([]);
		expect(o.ccPlan).toBe("goat");
		expect(o.workload).toEqual({
			input: 800,
			cacheRead: 50_000,
			output: 200,
			reasoning: 0,
			cacheWrite: 0,
		});
		expect(o.metric).toBe("val");
		expect(o.only).toBe("all");
		expect(o.colorMode).toBe("auto");
	});

	test("--bench default follows the AA key; an explicit --bench wins", () => {
		const saved = process.env.AA_API_KEY;
		try {
			delete process.env.AA_API_KEY;
			expect(parseArgs([]).bench).toBe(BENCH_DEFAULT.keyless);
			process.env.AA_API_KEY = "test-key";
			expect(parseArgs([]).bench).toBe(BENCH_DEFAULT.keyed);
			expect(parseArgs(["--bench", "cc"]).bench).toBe(
				BENCH_DEFAULT.keyless,
			);
			delete process.env.AA_API_KEY;
			expect(parseArgs(["--aa-key", "k"]).bench).toBe(
				BENCH_DEFAULT.keyed,
			);
		} finally {
			if (saved === undefined) delete process.env.AA_API_KEY;
			else process.env.AA_API_KEY = saved;
		}
	});

	test("workload overrides, space and equals forms", () => {
		const o = parseArgs(["--in", "1200", "--cache=0", "--out", "500"]);
		expect(o.workload).toEqual({
			input: 1200,
			cacheRead: 0,
			output: 500,
			reasoning: 0,
			cacheWrite: 0,
		});
	});

	test("plan, metric and boolean flags", () => {
		const o = parseArgs([
			"--cc-plan",
			"pro",
			"--metric",
			"req",
			"--peak",
			"--json",
		]);
		expect(o.ccPlan).toBe("pro");
		expect(o.metric).toBe("req");
		expect(o.peak).toBe(true);
		expect(o.json).toBe(true);
	});

	test("--no-* flags map to the negated option", () => {
		const o = parseArgs(["--no-color", "--no-fallback", "--no-ability"]);
		expect(o.colorMode).toBe("never");
		expect(o.noFallback).toBe(true);
		expect(o.noAbility).toBe(true);
	});

	test("columns split and pass help through", () => {
		expect(parseArgs(["--columns", "model, cost ,val"]).columns).toEqual([
			"model",
			"cost",
			"val",
		]);
		expect(parseArgs(["--columns", "help"]).columns).toEqual(["help"]);
	});

	test("weights parse as shares", () => {
		const o = parseArgs(["--bench-weight", "0.6", "--tps-weight", "0"]);
		expect(o.benchWeight).toBe(0.6);
		expect(o.tpsWeight).toBe(0);
	});

	test("column presets and the trimming default", () => {
		const base = parseArgs([]);
		expect(base.fit).toBe(true);
		expect(base.minimal).toBe(false);
		expect(base.medium).toBe(false);
		expect(parseArgs(["--minimal"]).minimal).toBe(true);
		expect(parseArgs(["--medium"]).medium).toBe(true);
		expect(parseArgs(["--no-fit"]).fit).toBe(false);
	});

	test("measured shape flags parse", () => {
		const o = parseArgs([
			"--shape",
			"measured",
			"--since",
			"2026-09-01",
			"--reasoning",
			"140",
			"--cache-write",
			"8",
		]);
		expect(o.shape).toBe("measured");
		expect(o.since).toBe("2026-09-01");
		expect(o.workload.reasoning).toBe(140);
		expect(o.workload.cacheWrite).toBe(8);
	});

	test("rejects unknown flags and bad values", () => {
		expect(() => parseArgs(["--nope"])).toThrow();
		expect(() => parseArgs(["--in", "-5"])).toThrow();
		expect(() => parseArgs(["--in", "1.5"])).toThrow();
		expect(() => parseArgs(["--width", "abc"])).toThrow();
		expect(() => parseArgs(["--bench-weight", "2"])).toThrow();
		expect(() => parseArgs(["--metric", "wat"])).toThrow();
		expect(() => parseArgs(["--only", "some"])).toThrow();
		// cac coerces `--width ""` to 0, which used to disable trimming silently.
		expect(() => parseArgs(["--width", ""])).toThrow();
		expect(() => parseArgs(["--width", "0"])).toThrow();
	});

	test("a value-taking flag used bare names the flag", () => {
		expect(() => parseArgs(["--usage-window"])).toThrow(
			/--usage-window expects a value/,
		);
		expect(() => parseArgs(["--cache-write"])).toThrow(
			/--cache-write expects a value/,
		);
	});

	test("--shape defaults to auto, and bare means measured", () => {
		expect(parseArgs([]).shape).toBe(SHAPE_AUTO);
		expect(parseArgs(["--shape"]).shape).toBe(SHAPE_MEASURED);
		expect(parseArgs(["--shape", SHAPE_OFF]).shape).toBe(SHAPE_OFF);
		expect(parseArgs(["--shape", "measured"]).shape).toBe(SHAPE_MEASURED);
		expect(parseArgs(["--shape", "/tmp/x.json"]).shape).toBe("/tmp/x.json");
	});

	test("help and version exit cleanly before any work", async () => {
		const logged: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		};
		try {
			expect(await run(["--no-config", "--help"])).toBe(0);
			expect(await run(["--no-config", "-v"])).toBe(0);
		} finally {
			console.log = original;
		}
		// Help text prints, but the table must not follow it.
		expect(logged.join("\n")).not.toContain("USAGE");
	});
});

describe("config layering and --print-config", () => {
	const tmp = () => mkdtempSync(join(tmpdir(), "mpc-cfg-"));

	test("a CLI plugin does not outrank the user config", async () => {
		const dir = tmp();
		const cfg = join(dir, "config.json");
		const plug = join(dir, "plug.json");
		writeFileSync(cfg, JSON.stringify({ ccPlan: "goat" }));
		writeFileSync(plug, JSON.stringify({ ccPlan: "pro" }));
		const bag = await resolveBag(["--config", cfg, "--plugin", plug]);
		expect(bag.ccPlan).toBe("goat");
	});

	test("an unknown config key fails under --print-config", async () => {
		const dir = tmp();
		const cfg = join(dir, "config.json");
		writeFileSync(cfg, JSON.stringify({ bogusKey: 1 }));
		await expect(run(["--config", cfg, "--print-config"])).rejects.toThrow(
			/bogusKey/,
		);
	});
});
