// CLI binaries the plugin shells out to. The opencode background service's PATH
// often lacks the homebrew prefix, so the bare name alone is not enough. Each
// caller prepends its env override (`CMDUSE_BIN` / `OCUSE_BIN`) before these
// fallbacks.
import { homedir } from "node:os";
import { join } from "node:path";

/** Fallback lookup paths for the cmduse CLI (CMDUSE_BIN wins when set). */
export const CMDUSE_BIN_CANDIDATES: readonly string[] = [
	"cmduse",
	"/opt/homebrew/bin/cmduse",
	"/usr/local/bin/cmduse",
];

/** Fallback lookup paths for mpc, the per-model catalog scraper. */
export const MPC_BIN_CANDIDATES: readonly string[] = [
	"mpc",
	join(homedir(), ".bun/bin/mpc"),
	"/opt/homebrew/bin/mpc",
];

/** Fallback lookup paths for ocuse (OCUSE_BIN wins when set). */
export const OCUSE_BIN_CANDIDATES: readonly string[] = [
	"ocuse",
	"/opt/homebrew/bin/ocuse",
	"/usr/local/bin/ocuse",
];
