import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPAWN_OPTIONS } from "../src/constants/cli";
import {
	metaArgs,
	parseMpcJson,
	parseUsageJson,
	requireSnapshot,
	zenArgs,
} from "../src/sidebar/data";
import {
	loadModelUsage,
	loadSessionUsage,
	periodStart,
} from "../src/sidebar/usageDb";

const USAGE = JSON.stringify({
	error: null,
	plan: "GOAT",
	monthlyCap: 70,
	monthlyCredits: 19.44,
	periodEnd: "2026-09-27",
	fiveHour: { cap: 14, exceeded: false, resetAt: 1790258372737, used: 1.17 },
	weekly: { cap: 35, exceeded: false, resetAt: 1790331314090, used: 12.43 },
	summary: { requests: 6296, cost: 46.31, tokensIn: 1, tokensOut: 2 },
});

describe("parseUsageJson", () => {
	test("lifts the fields the sidebar needs", () => {
		const usage = parseUsageJson(USAGE);
		expect(usage.plan).toBe("GOAT");
		expect(usage.monthlyCap).toBe(70);
		expect(usage.monthlyCredits).toBe(19.44);
		expect(usage.fiveHour?.cap).toBe(14);
		expect(usage.weekly?.used).toBe(12.43);
		expect(usage.requests).toBe(6296);
		expect(usage.cost).toBe(46.31);
	});
	test("tolerates a partial payload", () => {
		expect(parseUsageJson("{}")).toEqual({
			plan: undefined,
			monthlyCap: undefined,
			monthlyCredits: undefined,
			fiveHour: undefined,
			weekly: undefined,
			periodEnd: undefined,
			requests: undefined,
			cost: undefined,
			error: undefined,
		});
	});
});

describe("requireSnapshot", () => {
	// cmduse -1 --json exits 0 when the account API is unreachable and publishes
	// the defaults (plan "Free", no windows) beside `error`. Painting that over a
	// good snapshot is what made the Monthly row flash during an outage.
	test("rejects the errored defaults so the panel keeps its last snapshot", () => {
		const usage = parseUsageJson(
			JSON.stringify({ error: "credits: transport error", plan: "Free" }),
		);
		expect(usage.error).toBe("credits: transport error");
		expect(() => requireSnapshot(usage)).toThrow("transport error");
	});

	test("passes a healthy snapshot through", () => {
		expect(requireSnapshot(parseUsageJson(USAGE)).plan).toBe("GOAT");
	});

	test("a null error is not an error", () => {
		expect(requireSnapshot(parseUsageJson(USAGE)).error).toBeUndefined();
	});
});

const MPC = JSON.stringify({
	plans: { cc: { label: "GOAT" } },
	rows: [
		{
			key: "deepseekv41flash",
			name: "DeepSeek V4.1 Flash",
			cc: {
				allowance: 60,
				pricing: {
					input: 0.15,
					output: 0.6,
					cacheRead: 0.003,
					cacheWrite: null,
				},
				ability: 39.5,
				tps: 237,
				deal: { badge: "-98%", ends: "Ends September 30, 2026" },
			},
			oc: {
				provider: "oc-go",
				plan: "Go",
				allowance: 60,
				pricing: { input: 0.1, output: 0.2, cacheRead: 0.002 },
				ability: 48,
				tps: 120,
			},
		},
		{
			key: "opencodeonly",
			name: "Some OC Model",
			oc: {
				provider: "oc-go",
				plan: "Go",
				allowance: 60,
				pricing: { input: 0.1, output: 0.2, cacheRead: 0.002 },
				ability: 48,
				tps: 120,
			},
		},
		{ key: "neitherside", name: "Neither Side" },
	],
});

describe("parseMpcJson", () => {
	test("maps the CommandCode side and the OpenCode side of the same row", () => {
		const meta = parseMpcJson(MPC);
		const entry = meta.get("deepseekv41flash");
		expect(entry?.allowance).toBe(60);
		expect(entry?.intelligence).toBe(39.5);
		expect(entry?.tps).toBe(237);
		expect(entry?.rates?.cacheRead).toBe(0.003);
		expect(entry?.tier).toBeUndefined(); // tier is resolved from the model id at render
		// The Go/Zen panel reads the other side of the same catalog row.
		expect(entry?.deal).toEqual({
			badge: "-98%",
			ends: "Ends September 30, 2026",
		});
		expect(entry?.oc).toEqual({
			provider: "oc-go",
			plan: "Go",
			allowance: 60,
			rates: { input: 0.1, output: 0.2, cacheRead: 0.002 },
			ability: 48,
			tps: 120,
		});
	});
	test("keeps a row with only an OpenCode side, drops one with neither", () => {
		const meta = parseMpcJson(MPC);
		const names = [...meta.values()].map((m) => m.name);
		expect(names).toContain("Some OC Model");
		expect(meta.get("someocmodel")?.oc?.allowance).toBe(60);
		expect(meta.get("someocmodel")?.allowance).toBeUndefined();
		expect(names).not.toContain("Neither Side");
	});

	test("keeps the `free` flag on both sides so a zero allowance is read as unbounded", () => {
		// mpc marks a free/unbounded row free and gives it allowance 0; without
		// the flag the panel cannot tell that from an empty $0 budget.
		const meta = parseMpcJson(
			JSON.stringify({
				rows: [
					{
						key: "step5preview",
						name: "Step 5 Preview",
						cc: { allowance: 20, free: false },
						oc: { allowance: 0, free: true },
					},
					{
						key: "ccfree",
						name: "CC Free",
						cc: { allowance: 0, free: true },
						oc: { allowance: 60, free: false },
					},
				],
			}),
		);
		expect(meta.get("step5preview")?.free).toBeUndefined();
		expect(meta.get("step5preview")?.oc?.free).toBe(true);
		expect(meta.get("ccfree")?.free).toBe(true);
		expect(meta.get("ccfree")?.oc?.free).toBeUndefined();
	});
});

describe("CLI args", () => {
	test("ocuse is asked for the selected Go plan", () => {
		expect(zenArgs("go")).toEqual(["-1", "--json", "--plan", "go"]);
		expect(zenArgs("go-plus")).toEqual([
			"-1",
			"--json",
			"--plan",
			"go-plus",
		]);
	});

	test("mpc keeps `--shape off` and takes the plan", () => {
		// `--shape off` is the recursion break (mpc -> reqshape -> mpc); it must
		// survive alongside the plan flag.
		expect(metaArgs("go")).toEqual([
			"--json",
			"--shape",
			"off",
			"--oc-plan",
			"go",
		]);
		expect(metaArgs("go-plus")).toEqual([
			"--json",
			"--shape",
			"off",
			"--oc-plan",
			"go-plus",
		]);
	});
});

test("parseMpcJson keeps the mpc key and a local key for lookup", () => {
	const meta = parseMpcJson(
		JSON.stringify({
			rows: [
				{
					key: "tencenthy3",
					name: "Tencent Hy3",
					cc: {
						allowance: 70,
						pricing: {
							input: 0.14,
							output: 0.58,
							cacheRead: 0.035,
						},
					},
				},
			],
		}),
	);
	const tencent = meta.get("tencenthy3");
	expect(tencent).toBeDefined();
	expect(tencent).toBe(meta.get("tencenthy3"));
});

// Regression: cmduse's snapshot() writes a "fetching usage…" spinner directly
// to /dev/tty, so without `detached` (no controlling terminal) it overpaints
// the opencode TUI prompt on every poll.
test("spawns cmduse with no controlling terminal", () => {
	expect(SPAWN_OPTIONS.detached).toBe(true);
});

/** Minimal stand-in for opencode's `message` store. */
function fixtureDb(): string {
	const path = join(mkdtempSync(join(tmpdir(), "cc-usage-")), "opencode.db");
	const db = new Database(path);
	db.run("CREATE TABLE message (data TEXT, time_created INTEGER)");
	const row = (data: object, at: number) =>
		db.run("INSERT INTO message VALUES (?, ?)", [JSON.stringify(data), at]);
	const model = "deepseek/deepseek-v4.1-flash";
	const now = Date.now();
	row(
		{ role: "assistant", modelID: model, tokens: { input: 1 }, cost: 0.5 },
		now - 1_000,
	);
	row(
		{ role: "assistant", modelID: model, tokens: { input: 1 }, cost: 1.25 },
		now - 2_000,
	);
	row(
		{
			role: "assistant",
			modelID: "other/model",
			tokens: { input: 1 },
			cost: 9,
		},
		now - 1_000,
	);
	row(
		{ role: "user", modelID: model, tokens: { input: 1 }, cost: 3 },
		now - 1_000,
	);
	row(
		{ role: "assistant", modelID: model, tokens: { input: 1 }, cost: 5 },
		now - 40 * 86_400_000,
	);
	db.close();
	return path;
}

describe("loadModelUsage", () => {
	test("sums the window for one model only", () => {
		const path = fixtureDb();
		const week = Date.now() - 7 * 86_400_000;
		expect(
			loadModelUsage("deepseek/deepseek-v4.1-flash", week, path),
		).toEqual({
			requests: 2,
			cost: 1.75,
		});
		// the vendored id and the bare one share a canonical key
		expect(
			loadModelUsage("deepseek-v4.1-flash", week, path)?.requests,
		).toBe(2);
	});
	test("returns null without a store", () => {
		expect(
			loadModelUsage(
				"deepseek/deepseek-v4.1-flash",
				0,
				"/nope/missing.db",
			),
		).toBeNull();
	});
});

describe("loadSessionUsage", () => {
	test("counts one session, once per message id", () => {
		const dir = mkdtempSync(join(tmpdir(), "cc-session-"));
		const path = join(dir, "opencode.db");
		const db = new Database(path);
		db.run(
			"CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER)",
		);
		const row = (id: string, session: string, data: object) =>
			db.run("INSERT INTO message VALUES (?, ?, ?, ?)", [
				id,
				session,
				JSON.stringify(data),
				Date.now(),
			]);
		row("m1", "ses_a", {
			role: "assistant",
			modelID: "x/y",
			tokens: { input: 1 },
			cost: 0.5,
		});
		row("m2", "ses_a", {
			role: "assistant",
			modelID: "x/y",
			tokens: { input: 1 },
			cost: 1.25,
		});
		// Same id again: opencode rewrites message rows in place, and a rewrite
		// must not count twice.
		row("m2", "ses_a", {
			role: "assistant",
			modelID: "x/y",
			tokens: { input: 1 },
			cost: 1.25,
		});
		row("m3", "ses_b", {
			role: "assistant",
			modelID: "x/y",
			tokens: { input: 1 },
			cost: 9,
		});
		row("m4", "ses_a", { role: "user", tokens: { input: 1 }, cost: 3 });
		db.close();

		expect(loadSessionUsage("ses_a", path)).toEqual({
			requests: 2,
			cost: 1.75,
		});
		expect(loadSessionUsage("ses_b", path)).toEqual({
			requests: 1,
			cost: 9,
		});
	});

	test("returns null without a store", () => {
		expect(loadSessionUsage("ses_a", "/nope/missing.db")).toBeNull();
	});
});

/**
 * opencode v2's store: messages in `session_message` (with a model ref per
 * assistant turn) and per-session totals as columns in `session_v2`.
 */
function v2Db(): string {
	const dir = mkdtempSync(join(tmpdir(), "cc-v2-"));
	const path = join(dir, "opencode.db");
	const db = new Database(path);
	db.run("CREATE TABLE session_v2 (id TEXT, cost REAL)");
	db.run(
		"CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, time_created INTEGER, data TEXT)",
	);
	db.run("INSERT INTO session_v2 VALUES (?, ?)", ["ses_a", 3.5]);
	const insert = (
		id: string,
		session: string,
		type: string,
		at: number,
		data: object,
	) =>
		db.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)", [
			id,
			session,
			type,
			at,
			JSON.stringify(data),
		]);
	const now = Date.now();
	insert("u1", "ses_a", "user", now, { text: "hi" });
	insert("m1", "ses_a", "assistant", now - 1_000, {
		model: { id: "deepseek/deepseek-v4.1-flash" },
	});
	// The same model under its bare spelling: canonical keys must agree.
	insert("m2", "ses_a", "assistant", now - 2_000, {
		model: { id: "deepseek-v4.1-flash" },
	});
	insert("m3", "ses_a", "assistant", now - 1_000, {
		model: { id: "kimi-k2.7" },
	});
	// Another session on the same model: the period figure is account-wide.
	insert("m4", "ses_b", "assistant", now - 1_000, {
		model: { id: "deepseek/deepseek-v4.1-flash" },
	});
	insert("old", "ses_a", "assistant", now - 40 * 86_400_000, {
		model: { id: "deepseek/deepseek-v4.1-flash" },
	});
	db.close();
	return path;
}

describe("v2 store (session_message + session_v2)", () => {
	test("session totals come from session_v2, requests from assistant turns", () => {
		// Every assistant turn of the conversation counts, however old: the row
		// describes the session, not the billing period.
		expect(loadSessionUsage("ses_a", v2Db())).toEqual({
			requests: 4,
			cost: 3.5,
		});
		expect(loadSessionUsage("ses_b", v2Db())).toEqual({
			requests: 1,
			cost: 0,
		});
	});

	test("per-model requests match on the canonical key, period-wide", () => {
		const day = Date.now() - 86_400_000;
		// m1 + m4 (same model, two sessions) + m2 through its bare spelling.
		expect(loadModelUsage("deepseek-v4.1-flash", day, v2Db())).toEqual({
			requests: 3,
			cost: 0,
		});
		// The 40-day-old turn is outside the window.
		expect(
			loadModelUsage("deepseek/deepseek-v4.1-flash", day, v2Db())
				?.requests,
		).toBe(3);
		expect(loadModelUsage("kimi-k2.7", day, v2Db())?.requests).toBe(1);
	});

	test("scoped to a session, the window is that conversation", () => {
		// What the panel shows beside the session's own row: this model's share of
		// this conversation, so the two figures are comparable. A session scope
		// ignores the period, including the 40-day-old turn.
		const path = v2Db();
		expect(loadModelUsage("deepseek-v4.1-flash", 0, path, "ses_a")).toEqual(
			{
				requests: 3,
				cost: 0,
			},
		);
		expect(loadModelUsage("kimi-k2.7", 0, path, "ses_a")?.requests).toBe(1);
		expect(
			loadModelUsage("deepseek-v4.1-flash", 0, path, "ses_b")?.requests,
		).toBe(1);
	});
});

describe("periodStart", () => {
	const now = Date.UTC(2026, 8, 24);
	test("uses the published period start when cmduse sends one", () => {
		const startAt = Date.UTC(2026, 7, 27, 12, 23);
		expect(
			periodStart(
				{ periodStartAt: startAt, periodEnd: "2026-09-27" },
				now,
			),
		).toBe(startAt);
	});
	test("takes the period end one calendar month back without one", () => {
		expect(
			new Date(periodStart({ periodEnd: "2026-09-27" }, now))
				.toISOString()
				.slice(0, 10),
		).toBe("2026-08-27");
	});
	test("falls back to 30 days", () => {
		expect(periodStart({}, now)).toBe(now - 30 * 86_400_000);
	});
});
