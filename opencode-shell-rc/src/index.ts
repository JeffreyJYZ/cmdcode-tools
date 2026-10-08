/**
 * Server half (opencode v2): point every zsh the agent spawns at a `.zshenv`
 * shim (`ZDOTDIR`) that sources the user's aliases and functions. The shim is
 * refreshed only when the rc changes, so per-command cost stays ~0ms.
 */
import type { Plugin as PluginNs } from "@opencode/plugin";
import { SHELL_RC_ID } from "./constants/shell-rc";
import { isZsh, prepare, stateDir } from "./shim";

export const shellRcPlugin: PluginNs.Plugin = {
	id: SHELL_RC_ID,
	async setup(ctx) {
		// Best effort: if this throws, the shell hook stays a no-op.
		try {
			prepare();
		} catch {
			// ignore
		}

		await ctx.shell.hook("create.before", (event) => {
			if (!isZsh(event.shell)) return;
			try {
				prepare();
				event.env.ZDOTDIR = stateDir();
			} catch {
				// Any failure leaves the shell exactly as it was.
			}
		});
	},
};

export default shellRcPlugin;
