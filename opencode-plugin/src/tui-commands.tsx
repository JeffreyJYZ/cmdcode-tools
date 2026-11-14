/** @jsxImportSource @opentui/solid */
// The v2 host's slash commands, kept out of tui.tsx so the plugin entry stays
// readable. `registerCommands` is called from inside the app-slot render:
// `keymap.layer()` only works from a render, and the app slot is the mount
// point that is always present (the same claim opencode's own slash commands
// use). Each command keeps its id, because `bindings` below turns a user's
// configured keybind for that id into a live binding.
import type { Plugin as TuiPluginNs } from "@opencode/plugin/tui";
import { arkuseArgs, ocuseArgs, runArkuse, runCmduse, runOcuse } from "./cli";
import {
	ARKUSE_USAGE_COMMAND_ID,
	CMD_USAGE_COMMAND_ID,
	OCUSE_USAGE_COMMAND_ID,
} from "./constants/providers";
import { SettingsDialog } from "./sidebar/settings";

/** The /cmd-settings command id (kept beside its siblings, which live in constants). */
export const SETTINGS_COMMAND_ID = "command-code.settings";

const GROUP = "Command Code";

export function registerCommands(ctx: TuiPluginNs.Context): void {
	ctx.keymap.layer(() => ({
		mode: "global",
		priority: 10,
		commands: [
			{
				id: CMD_USAGE_COMMAND_ID,
				title: "Command Code usage",
				group: GROUP,
				slash: { name: "cmd-usage", arguments: true },
				enabled: () => true,
				suggested: true,
				run: async (input) => {
					let text: string;
					try {
						text = await runCmduse(input ?? "");
					} catch (error) {
						ctx.ui.toast.show({
							title: "cmd-usage failed",
							message: error instanceof Error ? error.message : String(error),
							variant: "error",
						});
						return;
					}
					await ctx.ui.dialog.alert({
						title: "Command Code usage",
						message: text.trimEnd(),
					});
				},
			},
			{
				id: OCUSE_USAGE_COMMAND_ID,
				title: "OpenCode Go/Zen usage",
				group: GROUP,
				slash: { name: "ocuse-usage", arguments: true },
				enabled: () => true,
				suggested: true,
				// Empty input defaults to `-1` (see `ocuseArgs`): a bare ocuse is the
				// live watch loop and would never resolve the dialog.
				run: async (input) => {
					let text: string;
					try {
						text = await runOcuse(ocuseArgs(input));
					} catch (error) {
						ctx.ui.toast.show({
							title: "ocuse-usage failed",
							message: error instanceof Error ? error.message : String(error),
							variant: "error",
						});
						return;
					}
					await ctx.ui.dialog.alert({
						title: "OpenCode Go/Zen usage",
						message: text.trimEnd(),
					});
				},
			},
			{
				id: ARKUSE_USAGE_COMMAND_ID,
				title: "Volcengine ARK usage",
				group: GROUP,
				slash: { name: "arkuse-usage", arguments: true },
				enabled: () => true,
				suggested: true,
				// Empty input means `-1` (see `arkuseArgs`): a bare arkuse is the
				// live watch loop.
				run: async (input) => {
					let text: string;
					try {
						text = await runArkuse(arkuseArgs(input));
					} catch (error) {
						ctx.ui.toast.show({
							title: "arkuse-usage failed",
							message: error instanceof Error ? error.message : String(error),
							variant: "error",
						});
						return;
					}
					await ctx.ui.dialog.alert({
						title: "Volcengine ARK usage",
						message: text.trimEnd(),
					});
				},
			},
			{
				id: SETTINGS_COMMAND_ID,
				title: "Command Code settings",
				group: GROUP,
				palette: true,
				slash: { name: "cmd-settings" },
				enabled: () => true,
				suggested: true,
				run: () => ctx.ui.dialog.show(() => <SettingsDialog ctx={ctx} />),
			},
		],
		bindings: [
			CMD_USAGE_COMMAND_ID,
			OCUSE_USAGE_COMMAND_ID,
			ARKUSE_USAGE_COMMAND_ID,
			SETTINGS_COMMAND_ID,
		],
	}));
}
