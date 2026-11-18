#!/usr/bin/env bun
// Feature-parity check across the four usage readers: cmduse, ocuse, arkuse,
// oduse. Compares the long flags each binary advertises in `--help`, so it
// catches a flag one binary gains without the other three.
//
//   bun parity                      # from the repo root
//   CMDUSE_BIN=... OCUSE_BIN=... bun parity   # point at specific builds
//
// Resolution order per binary: $<BIN>_BIN, target/debug/<bin>dev, <bin>dev on
// PATH, <bin> on PATH. If any of the four cannot be resolved or cannot print
// help, the check SKIPs with exit 0 — CI has no installed binary.
//
// The allow-list is the whole point: a difference is permitted only if it has
// a reason here. An undeclared difference fails, a stale entry fails, and an
// entry without a non-empty `reason` fails.

import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const BINS = ["cmduse", "ocuse", "arkuse", "oduse"] as const;
type Bin = (typeof BINS)[number];

interface Allow {
	flag: string;
	/** The exact set of binaries expected to carry this flag. */
	binaries: Bin[];
	/** Why the source forces the difference. Required, never optional. */
	reason: string;
}

const ALLOW: Allow[] = [
	{
		flag: "--local",
		binaries: ["cmduse"],
		reason: "cmduse alone reads the Command Code account API beside local CLI logs; --local picks that account-vs-logs cut. The other sources have no second store to switch to.",
	},
	{
		flag: "--gated",
		binaries: ["cmduse", "ocuse", "arkuse"],
		reason: "OpenDesign prices models per plan but never restricts which ones a plan may call, so a gate filter there would invent a restriction the source does not have (the parser rejects it for oduse).",
	},
	{
		flag: "--db",
		binaries: ["ocuse", "arkuse", "oduse"],
		reason: "Only those three point a local store at the tool (opencode.db / the app's sqlite). cmduse's local source is ~/.commandcode/projects, so a --db path has nothing to select.",
	},
	{
		flag: "--no-api",
		binaries: ["ocuse", "arkuse"],
		reason: "These two skip their own remote meter (Go usage endpoint / arkcli control plane). cmduse's equivalent skip is --local and oduse's remote route is the wallet (--no-wallet).",
	},
	{
		flag: "--no-wallet",
		binaries: ["oduse"],
		reason: "Only oduse has the OpenDesign local wallet daemon as a meter; no other binary has that listener to skip.",
	},
	{
		flag: "--session-cookie",
		binaries: ["oduse"],
		reason: "Only oduse reaches the OpenDesign account API with a user-supplied console session cookie (0600 file / $OD_SESSION); no other source needs that credential.",
	},
	{
		flag: "--plan",
		binaries: ["ocuse", "arkuse", "oduse"],
		reason: "Names which plan's limits to measure against for sources that cannot report it themselves (Go tier / ARK tier / OpenDesign tier). cmduse's plan comes from its own account.",
	},
	{
		flag: "--profile",
		binaries: ["arkuse"],
		reason: "arkcli control-plane profile; only ARK reads the plan meters through arkcli.",
	},
	{
		flag: "--window",
		binaries: ["ocuse", "arkuse", "oduse"],
		reason: "Local stores need their report cut (month / all / <n>d) chosen here; cmduse's account API hands its period back and its reports use --days/--since.",
	},
	{
		flag: "--period-start",
		binaries: ["ocuse", "arkuse", "oduse"],
		reason: "Pins a local store's billing period; cmduse gets its period from the account API, so there is nothing to pin.",
	},
	{
		flag: "--infer-anniversary",
		binaries: ["ocuse", "arkuse", "oduse"],
		reason: "Infers a missing period start from the first local request; cmduse has no local period to infer because the account API supplies it.",
	},
];

function executable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function resolveBin(bin: Bin): string | null {
	const fromEnv = process.env[`${bin.toUpperCase()}_BIN`];
	if (fromEnv) {
		// An explicit override is authoritative: a missing path means SKIP, never
		// a silent fallback to a different build of that binary.
		const path = isAbsolute(fromEnv) ? fromEnv : resolve(ROOT, fromEnv);
		return executable(path) ? path : null;
	}
	const candidates = [join(ROOT, "target", "debug", `${bin}dev`), `${bin}dev`, bin];
	for (const candidate of candidates) {
		if (executable(candidate)) return candidate;
		const found = Bun.which(candidate);
		if (found && executable(found)) return found;
	}
	return null;
}

function helpFlags(path: string): Set<string> | null {
	const run = spawnSync(path, ["--help"], { cwd: ROOT, encoding: "utf8" });
	const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
	// A successful help is Recognisable by its own `--help` token; a crashed or
	// substituted binary is not silently treated as "has no flags".
	if (!text.includes("--help")) return null;
	const flags = new Set<string>();
	for (const match of text.matchAll(/--[a-z][a-z0-9-]*/g)) flags.add(match[0]);
	return flags;
}

function check(helps: Map<Bin, Set<string>>, allow: Allow[]): string[] {
	const errors: string[] = [];
	const allowFlags = new Set<string>();

	for (const entry of allow) {
		if (!entry.flag.startsWith("--")) {
			errors.push(`allow-list flag ${JSON.stringify(entry.flag)} is not a long flag`);
		}
		if (allowFlags.has(entry.flag)) {
			errors.push(`allow-list has a duplicate entry for ${entry.flag}`);
		}
		allowFlags.add(entry.flag);
		if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
			errors.push(
				`allow-list entry ${entry.flag} has no reason (every difference needs one)`,
			);
		}
		if (entry.binaries.length === 0 || entry.binaries.some((b) => !BINS.includes(b as Bin))) {
			errors.push(`allow-list entry ${entry.flag} has an invalid binaries set`);
		}
	}

	for (const entry of allow) {
		const expected = new Set(entry.binaries);
		const present = BINS.filter((b) => helps.get(b)!.has(entry.flag));
		const missing = [...expected].filter((b) => !present.includes(b));
		const extra = present.filter((b) => !expected.has(b));
		if (missing.length > 0) {
			errors.push(
				`${entry.flag}: missing on ${missing.join(", ")} (declared there; reason: ${entry.reason})`,
			);
		}
		if (extra.length > 0) {
			errors.push(
				`${entry.flag}: extra on ${extra.join(", ")} (not declared; reason: ${entry.reason})`,
			);
		}
	}

	const everyFlag = new Set([...helps.values()].flatMap((flags) => [...flags]));
	for (const flag of [...everyFlag].sort()) {
		if (allowFlags.has(flag)) continue;
		const present = BINS.filter((b) => helps.get(b)!.has(flag));
		if (present.length !== BINS.length) {
			const missing = BINS.filter((b) => !helps.get(b)!.has(flag));
			errors.push(
				`${flag}: undeclared difference — missing on ${missing.join(", ")} (add it to all four or allow-list it with a reason)`,
			);
		}
	}
	return errors;
}

function printMatrix(helps: Map<Bin, Set<string>>, allow: Allow[]): void {
	const allowFlags = new Set(allow.map((a) => a.flag));
	const everyFlag = new Set([...helps.values()].flatMap((flags) => [...flags]));
	console.log(`flag                  ${BINS.map((b) => b.padEnd(7)).join("")}`);
	for (const flag of [...everyFlag].sort()) {
		const cells = BINS.map((b) => (helps.get(b)!.has(flag) ? "yes" : "-").padEnd(7));
		console.log(`${flag.padEnd(22)}${cells.join("")}${allowFlags.has(flag) ? " allow" : ""}`);
	}
	console.log("\nAllow-listed differences:");
	for (const entry of allow) {
		console.log(
			`  ${entry.flag.padEnd(22)}${entry.binaries.join(",").padEnd(28)}${entry.reason}`,
		);
	}
}

function main(): void {
	const helps = new Map<Bin, Set<string>>();
	const skipped: string[] = [];
	for (const bin of BINS) {
		const path = resolveBin(bin);
		if (!path) {
			skipped.push(
				`${bin}: no binary found (set ${bin.toUpperCase()}_BIN or build target/debug/${bin}dev)`,
			);
			continue;
		}
		const flags = helpFlags(path);
		if (!flags) {
			skipped.push(`${bin}: ${path} did not print --help`);
			continue;
		}
		helps.set(bin, flags);
		console.log(`${bin}: ${path}`);
	}
	if (skipped.length > 0) {
		console.log(`SKIP parity check: ${skipped.join("; ")}`);
		return;
	}

	printMatrix(helps, ALLOW);
	const errors = check(helps, ALLOW);
	if (errors.length > 0) {
		console.log(`\nFAIL parity check: ${errors.length} difference(s)`);
		for (const error of errors) console.log(`  - ${error}`);
		process.exitCode = 1;
		return;
	}
	const flags = new Set([...helps.values()].flatMap((f) => [...f])).size;
	console.log(
		`\nPASS parity check: 4 binaries, ${flags} flags, ${ALLOW.length} allowed differences`,
	);
}

main();
