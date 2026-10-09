#!/usr/bin/env bun
// Links the working-copy dev twins onto PATH — never the installed names.
//
//   bun run dev:link                 # link into ~/dev/bin
//   bun run dev:link -- --dir <dir>  # override the link directory
//
// Builds the Rust bins (`cargo build -p cmd-usage`, debug), then symlinks ONLY
// the four dev names — `cmdusedev`, `ocusedev` (Rust, from `target/debug/`) and
// `mpcdev`, `reqshapedev` (the bun entry files). The installed `cmduse` /
// `ocuse` / `mpc` / `reqshape` are never touched, so nothing published is
// shadowed; consumers point at these via CMDUSE_BIN / OCUSE_BIN / MPC_BIN /
// REQSHAPE_BIN.
//
// Idempotent: every link is removed and recreated, so a stale or dangling link
// (e.g. after `cargo clean`) is replaced rather than skipped. It also refuses
// to finish quietly if the link directory is not on PATH.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

/** One dev twin: the name to link and the absolute file it must run. */
interface DevCommand {
	name: string
	target: string
}

const DEV_COMMANDS: DevCommand[] = [
	{ name: "cmdusedev", target: join(ROOT, "target/debug/cmdusedev") },
	{ name: "ocusedev", target: join(ROOT, "target/debug/ocusedev") },
	{ name: "mpcdev", target: join(ROOT, "oc-cmd-compare/src/index.ts") },
	{ name: "reqshapedev", target: join(ROOT, "reqshape/src/index.ts") },
]

/** `--dir <path>` override, else `$HOME/dev/bin` with `~` expanded. */
function linkDir(argv: string[]): string {
	const i = argv.indexOf("--dir")
	if (i !== -1 && argv[i + 1]) return expandTilde(argv[i + 1])
	return join(homedir(), "dev", "bin")
}

function expandTilde(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path
}

function buildRustBins(): void {
	console.log("building Rust bins (cargo build -p cmd-usage)…")
	const result = spawnSync("cargo", ["build", "-p", "cmd-usage"], {
		cwd: ROOT,
		stdio: "inherit",
	})
	if (result.status !== 0) {
		console.error("dev:link: cargo build failed")
		process.exit(result.status ?? 1)
	}
}

function link(dir: string): void {
	mkdirSync(dir, { recursive: true })
	for (const { name, target } of DEV_COMMANDS) {
		if (!existsSync(target)) {
			console.error(`dev:link: missing build ${target}`)
			process.exit(1)
		}
		const linkPath = join(dir, name)
		// Remove first so a dangling link (after `cargo clean`) is replaced, not kept.
		rmSync(linkPath, { force: true })
		symlinkSync(target, linkPath)
		console.log(`${name} -> ${target}`)
	}
}

/** True when `dir` is one of `$PATH`'s entries (resolved, so `~`/trailing `/` do not fool it). */
function onPath(dir: string): boolean {
	const want = resolve(dir)
	return (process.env.PATH ?? "")
		.split(":")
		.some((entry) => entry !== "" && resolve(expandTilde(entry)) === want)
}

const dir = linkDir(process.argv.slice(2))
buildRustBins()
link(dir)

if (!onPath(dir)) {
	console.error(
		`dev:link: ${dir} is not on PATH — the links will not resolve. Add it with:\n  export PATH="${dir}:$PATH"`,
	)
	process.exit(1)
}

console.log(`linked ${DEV_COMMANDS.length} dev commands into ${dir} (on PATH)`)
