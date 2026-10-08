/** @jsxImportSource @opentui/solid */
// TUI half: the /context slash command. It collects the current session's
// context, then opens the breakdown in a dialog. Data is local (opencode's own
// stores) plus the sizes the server half captured, so nothing is spawned.

import type { Plugin as Tui } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { collectBreakdown } from "./collect";
import { COMMAND_ID, SLASH_NAME, TUI_ID } from "./constants/ids";
import { BreakdownDialog, type DialogColors } from "./dialog";

function dialogColors(ctx: Tui.Context): DialogColors {
	const text = ctx.theme.text;
	return { label: text.muted, value: text.base, muted: text.muted };
}

export const contextTui: Tui.Definition = {
	id: TUI_ID,
	setup(ctx) {
		// keymap.layer() must run inside a render, so mount a no-op and register
		// from there. Return void (a null render paints a stray prompt line).
		ctx.ui.slot({
			append: "app",
			render: (() => {
				ctx.keymap.layer(() => ({
					mode: "global",
					priority: 10,
					commands: [
						{
							id: COMMAND_ID,
							title: "Context window breakdown",
							group: "Context",
							slash: { name: SLASH_NAME },
							enabled: () => true,
							suggested: true,
							run: async () => {
								const route = ctx.ui.router.current();
								if (route.type !== "session") {
									ctx.ui.toast.show({
										title: "Context window",
										message: "Open a session first.",
										variant: "warning",
									});
									return;
								}
								let breakdown: Awaited<ReturnType<typeof collectBreakdown>>;
								try {
									breakdown = await collectBreakdown(ctx, route.sessionID);
								} catch (error) {
									ctx.ui.toast.show({
										title: "Context window failed",
										message:
											error instanceof Error ? error.message : String(error),
										variant: "error",
									});
									return;
								}
								ctx.ui.dialog.show(() => (
									<BreakdownDialog
										breakdown={breakdown}
										colors={dialogColors(ctx)}
									/>
								));
								ctx.ui.dialog.set({ size: "large", centered: true });
							},
						},
					],
					bindings: [COMMAND_ID],
				}));
			}) as unknown as () => JSX.Element,
		});
	},
};

export default contextTui;
