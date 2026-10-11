// cmduse invocation constants (see src/cli.ts).
import type { spawn } from "node:child_process";

/** Default invocation: one-shot dashboard, no colors / no live redraw. */
export const DEFAULT_ARGS: readonly string[] = ["-1", "--plain"];

/** Default mpc invocation: the fewest-columns view. mpc has no
 * subcommands to fall back on, so an empty arg must mean the
 * narrowest table — a bare tool call cannot dump a wide comparison
 * into the model's context. */
export const MPC_DEFAULT_ARGS: readonly string[] = ["--minimal"];

/** cmduse subcommands — when the arg starts with one, pass it through
 * untouched; otherwise it is extra flags for the one-shot dashboard. */
export const SUBCOMMANDS: ReadonlySet<string> = new Set([
	"plans",
	"models",
	"daily",
	"hourly",
	"model",
	"session",
	"statusline",
	"config",
]);

/** `detached` is load-bearing, not tidiness: it starts the child in its own
 * session, so it has no controlling terminal. cmduse's snapshot() paints a
 * "fetching usage…" spinner straight to /dev/tty — piping stdout/stderr does
 * not stop it — which would corrupt the opencode TUI this process inherits its
 * tty from. Detaching makes that open fail; stdout/stderr stay piped. */
export const SPAWN_OPTIONS: Parameters<typeof spawn>[2] = {
	stdio: ["ignore", "pipe", "pipe"],
	detached: true,
};
