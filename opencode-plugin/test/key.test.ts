import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateKeys, resolveKey } from "../src/key";

// A re-connect through /connect writes the live key into opencode's store and
// leaves `~/.commandcode/auth.json` on the one it replaced. Reading the files
// alone is what answered "Invalid 'Authorization' header or token" on an
// account whose inference worked, so the store has to rank first.

const saved = {
	home: process.env.HOME,
	data: process.env.XDG_DATA_HOME,
	db: process.env.OPENCODE_DB,
	key: process.env.CMD_API_KEY,
};

afterEach(() => {
	const restore = (name: string, value: string | undefined) => {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	};
	restore("HOME", saved.home);
	restore("XDG_DATA_HOME", saved.data);
	restore("OPENCODE_DB", saved.db);
	restore("CMD_API_KEY", saved.key);
});

/** A temp home holding an opencode store with `rows`. */
function fixture(rows: Array<[provider: string, key: string, active: number, updated: number]>) {
	const home = mkdtempSync(join(tmpdir(), "cmd-key-"));
	const opencode = join(home, ".local", "share", "opencode");
	mkdirSync(opencode, { recursive: true });
	const db = new Database(join(opencode, "opencode.db"));
	db.run(
		"CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)",
	);
	for (const [provider, key, active, updated] of rows) {
		db.run(
			"INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated) VALUES (?, ?, 'x', ?, ?, ?, ?)",
			[
				`cred_${provider}_${updated}`,
				provider,
				JSON.stringify({ type: "api", key }),
				active,
				updated,
				updated,
			],
		);
	}
	db.close();
	process.env.HOME = home;
	delete process.env.XDG_DATA_HOME;
	delete process.env.OPENCODE_DB;
	delete process.env.CMD_API_KEY;
	return { home, opencode };
}

describe("key candidates", () => {
	test("the active store row outranks the inactive one and the CLI file", async () => {
		const { home } = fixture([
			["commandcode", "user_dead", 0, 200],
			["commandcode", "user_live", 1, 100],
		]);
		mkdirSync(join(home, ".commandcode"), { recursive: true });
		writeFileSync(
			join(home, ".commandcode", "auth.json"),
			JSON.stringify({ apiKey: "user_cli" }),
		);
		const keys = await candidateKeys();
		expect(keys).toEqual(["user_live", "user_dead", "user_cli"]);
		expect(await resolveKey()).toBe("user_live");
		rmSync(home, { recursive: true, force: true });
	});

	test("CMD_API_KEY wins, and a store without the table falls through", async () => {
		const home = mkdtempSync(join(tmpdir(), "cmd-key-empty-"));
		const opencode = join(home, ".local", "share", "opencode");
		mkdirSync(opencode, { recursive: true });
		new Database(join(opencode, "opencode.db")).close();
		process.env.HOME = home;
		delete process.env.XDG_DATA_HOME;
		delete process.env.OPENCODE_DB;
		process.env.CMD_API_KEY = "env_key";
		expect(await candidateKeys()).toEqual(["env_key"]);
		rmSync(home, { recursive: true, force: true });
	});

	test("opencode's legacy auth.json is read before the CLI's", async () => {
		const { home, opencode } = fixture([]);
		writeFileSync(
			join(opencode, "auth.json"),
			JSON.stringify({ "command-code": { type: "api", key: "v1_key" } }),
		);
		mkdirSync(join(home, ".commandcode"), { recursive: true });
		writeFileSync(
			join(home, ".commandcode", "auth.json"),
			JSON.stringify({ apiKey: "cli_key" }),
		);
		expect(await candidateKeys()).toEqual(["v1_key", "cli_key"]);
		expect(await resolveKey()).toBe("v1_key");
		rmSync(home, { recursive: true, force: true });
	});
});
