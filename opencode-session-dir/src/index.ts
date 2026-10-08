/**
 * Server half (opencode v2): grant `external_directory` access only for the
 * directories bound to the requesting session, and advertise those directories
 * to the model. No commands here — the dialogs live in the TUI half (./tui).
 */
import type { Plugin as PluginNs } from "@opencode/plugin";
import { contextSection } from "./context";
import { PLUGIN_ID } from "./ids";
import { bindingsFor, expandHome, isUnderAny } from "./state";

/** `external_directory` resources are canonical boundaries, normally `<dir>/*`. */
function boundaryOf(resource: string): string {
	return expandHome(resource.replace(/\/\*$/, ""));
}

export const sessionDirPlugin: PluginNs.Plugin = {
	id: PLUGIN_ID,
	async setup(ctx) {
		// Every external-directory decision funnels through this hook before a
		// prompt is published, so allowing it here covers read/edit/glob/grep
		// and shell working directories uniformly. A configured `deny` still
		// wins — the hook only turns `ask` into `allow`.
		await ctx.permission.hook("evaluate", (event) => {
			if (event.action !== "external_directory" || event.effect !== "ask") {
				return;
			}
			const dirs = bindingsFor(String(event.sessionID));
			if (dirs.length === 0 || event.resources.length === 0) return;

			const allowed = event.resources.every((resource) =>
				isUnderAny(dirs, boundaryOf(resource)),
			);
			if (allowed) event.effect = "allow";
		});

		await ctx.session.hook("context", (event) => {
			for (const text of contextSection(bindingsFor(String(event.sessionID)))) {
				event.system.push({ type: "text", text });
			}
		});
	},
};

export default sessionDirPlugin;
