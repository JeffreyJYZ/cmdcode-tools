import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLogs } from "~/data/usage/logs.ts";

function writeLog(dir: string, name: string, lines: unknown[]): void {
	writeFileSync(
		join(dir, name),
		`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
	);
}

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), "mpc-logs-"));
	const project = join(root, "proj");
	mkdirSync(project, { recursive: true });
	return project;
}

const msg = (timestamp: string, model: string, cost: number) => ({
	type: "message",
	timestamp,
	model,
	usage: {
		inputTokens: 1000,
		outputTokens: 10,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: cost,
	},
});

describe("scanLogs", () => {
	test("aggregates per model, honouring the window", () => {
		const dir = scratch();
		writeLog(dir, "a.jsonl", [
			msg("2026-08-01T00:00:00Z", "zai-org/GLM-5.2", 1),
			msg("2026-09-20T00:00:00Z", "deepseek/deepseek-v4.1-flash", 2),
			msg("2026-09-21T00:00:00Z", "deepseek/deepseek-v4.1-flash", 3),
		]);
		const all = scanLogs(undefined, dir);
		expect(all).toHaveLength(2);
		const recent = scanLogs(new Date("2026-09-01T00:00:00Z"), dir);
		const flash = recent.find((e) => e.key === "deepseekv41flash");
		expect(flash?.requests).toBe(2);
		expect(flash?.costUsd).toBeCloseTo(5, 6);
		expect(recent.some((e) => e.key === "glm52")).toBe(false);
	});

	test("ignores checkpoint files and lines without usage", () => {
		const dir = scratch();
		writeLog(dir, "s.checkpoints.jsonl", [
			msg("2026-09-20T00:00:00Z", "x", 9),
		]);
		writeLog(dir, "b.jsonl", [{ type: "model_change", model: "y" }]);
		expect(scanLogs(undefined, dir)).toHaveLength(0);
	});
});
