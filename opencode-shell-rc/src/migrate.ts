#!/usr/bin/env node
/**
 * `shell-rc-migrate` — rewrite a legacy `blocked` string map into the
 * array-of-objects schema introduced in 0.5.0.
 *
 * Both shapes keep loading through `normalizeBlocked`, so migration is optional.
 * What this command adds is an actual conversion on disk: without it a config
 * stays legacy forever. The original is copied to `<file>.pre-0.5.1.bak` once,
 * before the first write, so a bad conversion is one `mv` away from undone.
 */
import { copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import pkg from "../package.json" with { type: "json" };
import { configFile, type BlockedEntry } from "./guards";

/** One-shot backup name. Bump with the package version that introduced the converter. */
export const BACKUP_SUFFIX = ".pre-0.5.1.bak";

/** The parsed command line. */
export interface Flags {
	config?: string;
	dryRun: boolean;
	check: boolean;
	help: boolean;
	version: boolean;
}

/** Parse with `cac`, the repo's CLI convention. */
export function parseFlags(argv: string[]): Flags {
	const cli = cac("shell-rc-migrate");
	cli.option(
		"--config <path>",
		"path to shell-rc.json (default $XDG_CONFIG_HOME/opencode/shell-rc.json)",
	);
	cli.option("--dry-run", "print the migrated JSON; write nothing");
	cli.option("--check", "exit 1 if a migration is needed, 0 otherwise (for CI)");
	cli.help();
	cli.version(pkg.version);
	const { options } = cli.parse(["node", "shell-rc-migrate", ...argv], { run: false });
	const flags = options as Record<string, unknown>;
	return {
		config: typeof flags.config === "string" && flags.config ? flags.config : undefined,
		dryRun: flags.dryRun === true,
		check: flags.check === true,
		help: flags.help === true,
		version: flags.version === true,
	};
}

/** The three things a config can be, from the converter's point of view. */
export type MigrateResult =
	| { status: "migrated"; config: Record<string, unknown> }
	| { status: "already" }
	| { status: "none" };

/**
 * Pure conversion of a parsed config, reusing the normaliser's rules so the
 * generated array renders exactly the guards the legacy map did.
 *
 * Only a plain object under `blocked` needs work. An array is already current;
 * a missing or malformed `blocked` is left alone (the guard layer treats it as
 * "block nothing", and inventing entries would change behaviour).
 */
export function migrateObject(parsed: unknown): MigrateResult {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "none" };
	const config = parsed as Record<string, unknown>;
	const blocked = config.blocked;
	if (Array.isArray(blocked)) return { status: "already" };
	if (!blocked || typeof blocked !== "object") return { status: "none" };
	const entries: BlockedEntry[] = [];
	for (const [name, value] of Object.entries(blocked as Record<string, unknown>)) {
		// The same skips normalizeBlocked applies to a legacy map: a non-string
		// or blank value carries no guard. Trimming is what the normaliser does
		// to either shape, so doing it here keeps the rendered script identical.
		if (typeof value !== "string" || !value.trim() || !name.trim()) continue;
		entries.push({ name: name.trim(), alternative: value.trim() });
	}
	// Reassigning an existing key keeps its position, so `env` and every unknown
	// key stay where the user wrote them.
	return { status: "migrated", config: { ...config, blocked: entries } };
}

/** Tab-indented JSON with a trailing newline — the repo's config style. */
export function renderMigrated(config: Record<string, unknown>): string {
	return `${JSON.stringify(config, null, "\t")}\n`;
}

/**
 * Run the command. Returns the process exit code; it never calls `process.exit`,
 * so tests can drive the real I/O seam in a temp directory.
 */
export function run(argv: string[]): number {
	const flags = parseFlags(argv);
	if (flags.help || flags.version) return 0;
	const target = flags.config ?? configFile();

	let raw: string;
	try {
		raw = readFileSync(target, "utf8");
	} catch {
		console.log(`no config file at ${target}`);
		return 0;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		// The parser's own message is the most useful thing to print: it names
		// the position and the fault, and adding prose only hides it.
		console.log((error as Error).message);
		return 2;
	}

	const result = migrateObject(parsed);
	if (result.status === "already") {
		console.log("already on the object schema");
		return 0;
	}
	if (result.status === "none") {
		console.log("no legacy string map in blocked; nothing to migrate");
		return 0;
	}
	if (flags.check) {
		console.log("migration needed: blocked is a string map");
		return 1;
	}

	const text = renderMigrated(result.config);
	if (flags.dryRun) {
		process.stdout.write(text);
		return 0;
	}

	const backup = target + BACKUP_SUFFIX;
	if (existsSync(backup)) {
		console.log(`backup already exists, leaving it untouched: ${backup}`);
	} else {
		try {
			copyFileSync(target, backup);
		} catch (error) {
			console.log(`could not write backup ${backup}: ${(error as Error).message}`);
			return 2;
		}
	}
	try {
		writeFileSync(target, text);
	} catch (error) {
		console.log(`could not write ${target}: ${(error as Error).message}`);
		return 2;
	}
	console.log(`migrated ${target}`);
	return 0;
}

/** True only when this file is the process entry point, under bun or node. */
function invokedDirectly(): boolean {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (invokedDirectly()) process.exit(run(process.argv.slice(2)));
