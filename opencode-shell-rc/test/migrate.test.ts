import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type BlockedEntry, loadConfig, renderGuards } from "../src/guards";
import { BACKUP_SUFFIX, migrateObject, renderMigrated, run } from "../src/migrate";
import { restoreEnv } from "./helpers";

const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
let dir: string;
let target: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "shell-rc-migrate-"));
	process.env.HOME = dir;
	process.env.XDG_CONFIG_HOME = join(dir, "config");
	target = join(dir, "config", "opencode", "shell-rc.json");
});

afterEach(() => {
	restoreEnv("HOME", saved.HOME);
	restoreEnv("XDG_CONFIG_HOME", saved.XDG_CONFIG_HOME);
	rmSync(dir, { recursive: true, force: true });
});

/** Write raw bytes so malformed JSON and exact indentation are both testable. */
function writeConfig(text: string, path = target): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

/** Capture both console.log and raw stdout (--dry-run writes there). */
function capture(fn: () => number): { code: number; out: string } {
	const log = console.log;
	const write = process.stdout.write;
	const chunks: string[] = [];
	console.log = (...args: unknown[]) => {
		chunks.push(args.map(String).join(" "));
	};
	process.stdout.write = ((chunk: string | Uint8Array) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		return { code: fn(), out: chunks.join("") };
	} finally {
		console.log = log;
		process.stdout.write = write;
	}
}

const LEGACY =
	'{\n\t"env": { "K": "v" },\n\t"blocked": {\n\t\t"find": "fd",\n\t\t"grep": "rg",\n\t\t"sed": "sd"\n\t},\n\t"unknown": { "n": 1 }\n}\n';

const MIGRATED_ENTRIES = [
	{ name: "find", alternative: "fd" },
	{ name: "grep", alternative: "rg" },
	{ name: "sed", alternative: "sd" },
];

describe("shell-rc-migrate", () => {
	test("converts a string map to an array, preserving other keys, order and style", () => {
		writeConfig(LEGACY);
		expect(capture(() => run([])).code).toBe(0);
		const text = readFileSync(target, "utf8");
		expect(text.endsWith("\n")).toBe(true);
		expect(text).toContain('\t"blocked": [\n');
		const parsed = JSON.parse(text);
		expect(parsed.blocked).toEqual(MIGRATED_ENTRIES);
		expect(parsed.env).toEqual({ K: "v" });
		expect(parsed.unknown).toEqual({ n: 1 });
		expect(Object.keys(parsed)).toEqual(["env", "blocked", "unknown"]);
	});

	test("leaves an already-migrated config alone", () => {
		const text = '{\n\t"blocked": [{ "name": "find", "alternative": "fd" }]\n}\n';
		writeConfig(text);
		const { code, out } = capture(() => run([]));
		expect(code).toBe(0);
		expect(out).toContain("already on the object schema");
		expect(readFileSync(target, "utf8")).toBe(text);
		expect(existsSync(target + BACKUP_SUFFIX)).toBe(false);
	});

	test("a missing config file is not an error", () => {
		const { code, out } = capture(() => run([]));
		expect(code).toBe(0);
		expect(out).toContain("no config file");
		expect(existsSync(target)).toBe(false);
	});

	test("a missing blocked key writes nothing", () => {
		const text = '{\n\t"env": { "A": "B" }\n}\n';
		writeConfig(text);
		const { code } = capture(() => run([]));
		expect(code).toBe(0);
		expect(readFileSync(target, "utf8")).toBe(text);
		expect(existsSync(target + BACKUP_SUFFIX)).toBe(false);
	});

	test("malformed JSON exits 2 with the parser's message and writes nothing", () => {
		writeConfig("{not json");
		let message = "";
		try {
			JSON.parse("{not json");
		} catch (error) {
			message = (error as Error).message;
		}
		const { code, out } = capture(() => run([]));
		expect(code).toBe(2);
		expect(out).toContain(message);
		expect(readFileSync(target, "utf8")).toBe("{not json");
		expect(existsSync(target + BACKUP_SUFFIX)).toBe(false);
	});

	test("--dry-run prints the migrated JSON and writes nothing", () => {
		writeConfig(LEGACY);
		const { code, out } = capture(() => run(["--dry-run"]));
		expect(code).toBe(0);
		expect(out).toBe(
			renderMigrated({ env: { K: "v" }, blocked: MIGRATED_ENTRIES, unknown: { n: 1 } }),
		);
		expect(readFileSync(target, "utf8")).toBe(LEGACY);
		expect(existsSync(target + BACKUP_SUFFIX)).toBe(false);
	});

	test("--check exits 1 for a legacy map and 0 for the array form", () => {
		writeConfig(LEGACY);
		expect(capture(() => run(["--check"])).code).toBe(1);
		expect(readFileSync(target, "utf8")).toBe(LEGACY);
		writeConfig('{\n\t"blocked": []\n}\n');
		expect(capture(() => run(["--check"])).code).toBe(0);
	});

	test("--config overrides the XDG default", () => {
		const other = join(dir, "custom", "shell-rc.json");
		writeConfig(LEGACY, other);
		expect(capture(() => run(["--config", other])).code).toBe(0);
		expect(JSON.parse(readFileSync(other, "utf8")).blocked).toEqual(MIGRATED_ENTRIES);
		expect(existsSync(other + BACKUP_SUFFIX)).toBe(true);
	});

	test("the backup is a byte-exact copy, written once and never clobbered", () => {
		writeConfig(LEGACY);
		expect(capture(() => run([])).code).toBe(0);
		const backup = target + BACKUP_SUFFIX;
		expect(readFileSync(backup, "utf8")).toBe(LEGACY);

		// Put the map back and pre-existing backup text in place: the second run
		// must convert again without overwriting the first copy.
		writeConfig(LEGACY);
		writeFileSync(backup, "first copy");
		const { code, out } = capture(() => run([]));
		expect(code).toBe(0);
		expect(out).toContain("backup already exists");
		expect(readFileSync(backup, "utf8")).toBe("first copy");
		expect(JSON.parse(readFileSync(target, "utf8")).blocked).toEqual(MIGRATED_ENTRIES);
	});
});

describe("compatibility with the guard layer", () => {
	const legacyMap = {
		find: "fd",
		grep: "rg",
		"bad name": "whatever",
		cat: "bat",
		tccutil: "TCC changes are human-only; ask the user",
		blank: "   ",
	};
	// The first words checked against PATH by renderGuards.
	const installed = (command: string): boolean => command === "fd" || command === "rg";

	test("the migrated array renders byte-identical guards to the legacy map", () => {
		const result = migrateObject({ blocked: legacyMap });
		expect(result.status).toBe("migrated");
		if (result.status !== "migrated") return;
		expect(renderGuards(result.config.blocked as BlockedEntry[], installed)).toBe(
			renderGuards(legacyMap, installed),
		);
	});

	test("the same file loads through normalizeBlocked before and after migration", () => {
		writeConfig(`${JSON.stringify({ blocked: legacyMap }, null, "\t")}\n`);
		const before = renderGuards(loadConfig().blocked, installed);
		expect(capture(() => run([])).code).toBe(0);
		const after = renderGuards(loadConfig().blocked, installed);
		expect(after).toBe(before);
		expect(before).toContain("function find {");
		expect(before).toContain("function grep {");
	});
});
