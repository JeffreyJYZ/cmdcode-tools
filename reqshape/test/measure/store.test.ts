import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStore } from "#~/measure/store.ts";

function tempPath(): string {
	return join(mkdtempSync(join(tmpdir(), "reqshape-")), "opencode.db");
}

/** v2: `session_message` carries a typed row; `session` carries the context. */
function v2Store(): string {
	const path = tempPath();
	const db = new Database(path);
	db.run(
		"CREATE TABLE session (id text primary key, parent_id text, directory text)",
	);
	db.run(
		"CREATE TABLE session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)",
	);
	db.run(
		"INSERT INTO session VALUES ('ses_a', NULL, '/dev/one'), ('ses_b', 'ses_a', '/dev/two')",
	);
	const insert = db.prepare(
		"INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
	);
	const rows: Array<[string, string, string, number, number, unknown]> = [
		["m1", "ses_a", "user", 0, 1_000, { text: "add a flag" }],
		[
			"m2",
			"ses_a",
			"assistant",
			1,
			2_000,
			{
				model: { id: "deepseek/deepseek-v4.1-flash", providerID: "cc" },
				cost: 0.25,
				tokens: {
					input: 100,
					output: 50,
					cache: { read: 2000, write: 5 },
				},
			},
		],
		// Still streaming: model known, tokens absent.
		["m3", "ses_a", "assistant", 2, 3_000, { model: { id: "glm-5.2" } }],
		["m4", "ses_b", "synthetic", 0, 4_000, { text: "continue" }],
		[
			"m5",
			"ses_b",
			"assistant",
			1,
			5_000,
			{ tokens: { input: 1, output: 1 } },
		],
	];
	for (const [id, session, type, seq, time, data] of rows) {
		insert.run(id, session, type, seq, time, time, JSON.stringify(data));
	}
	db.close();
	return path;
}

/** Pre-v2: `message.data` is flat and `role` replaces `type`. */
function legacyStore(): string {
	const path = tempPath();
	const db = new Database(path);
	db.run(
		"CREATE TABLE message (id text primary key, session_id text, time_created integer, time_updated integer, data text)",
	);
	const insert = db.prepare(
		"INSERT INTO message VALUES (?, 'ses_1', ?, ?, ?)",
	);
	insert.run(
		"m1",
		1_000,
		1_000,
		JSON.stringify({ role: "user", text: "fix it" }),
	);
	insert.run(
		"m2",
		2_000,
		2_000,
		JSON.stringify({
			role: "assistant",
			modelID: "deepseek/deepseek-v4.1-flash",
			providerID: "cc",
			cost: 0.5,
			tokens: { input: 10, output: 20, cache: { read: 30, write: 0 } },
		}),
	);
	db.close();
	return path;
}

describe("readStore", () => {
	test("reads v2, keeping the session's context and skipping empty turns", () => {
		const store = readStore(v2Store());
		expect(store.layout).toBe("v2");
		expect(store.sessions.get("ses_a")).toEqual({
			child: false,
			directory: "/dev/one",
		});
		expect(store.sessions.get("ses_b")?.child).toBe(true);
		expect(store.messages.map((m) => m.kind)).toEqual([
			"user",
			"assistant",
			"assistant",
			"synthetic",
			"assistant",
		]);
		const first = store.messages[0];
		expect(first?.text).toBe("add a flag");
		const second = store.messages[1];
		expect(second?.model).toBe("deepseek/deepseek-v4.1-flash");
		expect(second?.cost).toBe(0.25);
		expect(second?.tokens?.cache?.read).toBe(2000);
		// The streaming turn arrives with no tokens rather than being dropped.
		expect(store.messages[2]?.tokens).toBeNull();
	});

	test("reads the legacy layout with role and modelID", () => {
		const store = readStore(legacyStore());
		expect(store.layout).toBe("legacy");
		expect(store.messages.map((m) => m.kind)).toEqual([
			"user",
			"assistant",
		]);
		expect(store.messages[1]?.model).toBe("deepseek/deepseek-v4.1-flash");
		expect(store.messages[1]?.tokens?.input).toBe(10);
		// The legacy payload carries `providerID`; reading it is what lets a
		// legacy store produce a PER SIDE section at all.
		expect(store.messages[1]?.provider).toBe("cc");
		// No session table: still readable, just unattributed.
		expect(store.sessions.size).toBe(0);
	});

	test("fails loudly when there is no store", () => {
		expect(() => readStore("/nonexistent/opencode.db")).toThrow(
			/no opencode store/,
		);
	});

	test("fails loudly on a store with neither layout", () => {
		const path = tempPath();
		new Database(path).close();
		expect(() => readStore(path)).toThrow(/cannot read/);
	});
});
