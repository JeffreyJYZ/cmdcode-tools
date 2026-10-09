import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUsage } from "#~/data/usage/index.ts";
import { mergeUsage, readUsageLog } from "#~/data/usage/log.ts";
import { parseUsage } from "#~/data/usage/parse.ts";

const CMDUSE = JSON.stringify({
	models: {
		"zai-org/GLM-5.2": {
			cacheRead: 7742976,
			cacheWrite: 0,
			costUsd: 15.72,
			requests: 142,
			tokensIn: 9637736,
			tokensOut: 49466,
		},
	},
});

describe("parseUsage", () => {
	test("reads the cmduse models map and normalises keys", () => {
		const [entry] = parseUsage(CMDUSE);
		expect(entry?.key).toBe("glm52");
		expect(entry?.requests).toBe(142);
		expect(entry?.tokensIn).toBe(9637736);
		expect(entry?.costUsd).toBeCloseTo(15.72, 2);
	});

	test("accepts a bare array of entries", () => {
		const rows = parseUsage(
			JSON.stringify([
				{ model: "GLM-5.3 Flash", requests: 3, tokensIn: 100 },
			]),
		);
		expect(rows[0]?.key).toBe("glm53flash");
		expect(rows[0]?.cacheRead).toBe(0);
	});
});

const BIN = "CMDUSE_BIN";

function fakeCmduse(stdout: string): string {
	const dir = mkdtempSync(join(tmpdir(), "mpc-cmduse-"));
	const path = join(dir, "cmdusedev");
	writeFileSync(
		path,
		`#!/bin/sh
printf '%s' '${stdout}'
`,
	);
	chmodSync(path, 0o755);
	return path;
}

describe("loadUsage", () => {
	afterEach(() => {
		delete process.env[BIN];
	});

	test("prefers `cmduse model --json` when it answers", async () => {
		process.env[BIN] = fakeCmduse(CMDUSE);
		const usage = await loadUsage(
			undefined,
			"all",
			"/nonexistent/usage.jsonl",
			"/nonexistent/opencode.db",
		);
		expect(usage.label).toBe("cmduse model --json");
		expect(usage.entries[0]?.key).toBe("glm52");
	});

	test("falls back to scanning session logs on a bad binary", async () => {
		process.env[BIN] = "/nonexistent/cmdusedev";
		// scanLogs otherwise reads $HOME/.commandcode/projects; inject a fixture
		// root so this does not depend on the machine having CommandCode sessions
		// (which is what made it pass locally and fail on CI).
		const root = mkdtempSync(join(tmpdir(), "mpc-cmdcode-"));
		writeFileSync(
			join(root, "session.jsonl"),
			`${JSON.stringify({
				timestamp: "2026-09-20T10:00:00Z",
				model: "GLM-5.3 Flash",
				usage: {
					inputTokens: 100,
					outputTokens: 10,
					cacheReadTokens: 1000,
					cacheWriteTokens: 0,
					costUsd: 0.5,
				},
			})}\n`,
		);

		const usage = await loadUsage(
			undefined,
			"all",
			"/nonexistent/usage.jsonl",
			"/nonexistent/opencode.db",
			root,
		);
		expect(usage.label).toBe("local session logs");
		expect(usage.entries[0]?.key).toBe("glm53flash");
	});
});

describe("readUsageLog", () => {
	const line = (ts: string, model: string, extra = "") =>
		`{"ts":"${ts}","model":"${model}","input":100,"cacheRead":1000,"cacheWrite":0,"output":10,"costUsd":0.5${extra}}`;

	test("aggregates per model and honours the window", () => {
		const dir = mkdtempSync(join(tmpdir(), "mpc-log-"));
		const path = join(dir, "usage.jsonl");
		writeFileSync(
			path,
			[
				line("2026-09-20T10:00:00Z", "deepseek/deepseek-v4.1-flash"),
				line("2026-09-21T10:00:00Z", "deepseek/deepseek-v4.1-flash"),
				line("2026-08-01T10:00:00Z", "z-ai/glm-5.3-flash"),
			].join("\n"),
		);
		const recent = readUsageLog(path, new Date("2026-09-01T00:00:00Z"));
		expect(recent).toHaveLength(1);
		expect(recent?.[0]?.key).toBe("deepseekv41flash");
		expect(recent?.[0]?.requests).toBe(2);
		expect(recent?.[0]?.costUsd).toBeCloseTo(1, 6);
		expect(readUsageLog(path, undefined)).toHaveLength(2);
	});

	test("missing file is null, not an error", () => {
		expect(readUsageLog("/nonexistent/usage.jsonl")).toBeNull();
	});
});

describe("mergeUsage", () => {
	test("sums the same model across sources", () => {
		const a = parseUsage(CMDUSE);
		const b = parseUsage(
			JSON.stringify([
				{ model: "zai-org/GLM-5.2", requests: 8, tokensIn: 100 },
			]),
		);
		const [row] = mergeUsage(a, b);
		expect(row?.requests).toBe(150);
		expect(row?.tokensIn).toBe(9637836);
	});
});
