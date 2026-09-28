/** @jsxImportSource @opentui/solid */
// OpenCode TUI half: a "Command Code" session-sidebar section (plan, rolling
// windows, period totals, plus the active model's allowance, rates and
// benchmarks), and — on v2 hosts — the /cmd-usage slash command that prints the
// full cmduse dashboard in a dialog.
//
// Two hosts, two TUI contracts, one module (same shape cmd-provider uses):
//   v1  `tui(api)`             — `api.slots.register({ slots: { sidebar_content } })`
//   v2  `setup(context)`       — `context.ui.slot({ append: "sidebar.content" })`
// Data comes from two read-only spawns: cmduse for usage (polled) and mpc for
// the per-model catalog (disk-cached; it scrapes docs).

import type { Plugin as TuiPluginNs } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { runCmduse } from "./cli";
import {
	hostColors,
	legacyColors,
	mono,
	Panel,
	type PanelColors,
} from "./sidebar/panel";
import { loadPrefs } from "./sidebar/prefs";
import { panelTitle, sessionKind, useRows } from "./sidebar/useRows";

// Plugin id is a stable contract (test/tui.test.ts pins it); the slot id is separate.
const ID = "command-code.tui";

/** Colour is opt-in (see sidebar/prefs.ts); off, every tone collapses to text. */
const themed = (colors: PanelColors): PanelColors =>
	loadPrefs().colors ? colors : mono(colors);

// ---- v1 host ---------------------------------------------------------------

interface V1Api {
	slots: {
		register: (config: {
			order?: number;
			slots: {
				sidebar_content: (
					ctx: unknown,
					props: { session_id: string },
				) => unknown;
			};
		}) => void;
	};
	state: {
		session: {
			get: (
				id: string,
			) => { model?: { providerID: string; id: string } } | undefined;
		};
	};
	theme: { current: { text: RGBA; textMuted: RGBA } };
}

function PanelV1(props: { api: V1Api; sessionID: string }) {
	const current = () => props.api.state.session.get(props.sessionID)?.model;
	const rows = useRows(
		() => current()?.id,
		() => current()?.providerID,
		() => props.sessionID,
	);
	return (
		<Panel
			title={() => panelTitle(sessionKind(current()?.providerID))}
			rows={rows}
			colors={() => themed(legacyColors(props.api.theme.current))}
		/>
	);
}

/** v1 half — snake_case slot map registered through `api.slots`. */
export const tui = async (api: V1Api): Promise<void> => {
	api.slots.register({
		order: 200,
		slots: {
			sidebar_content(_ctx, props) {
				return <PanelV1 api={api} sessionID={props.session_id} />;
			},
		},
	});
};

// ---- v2 host ---------------------------------------------------------------

function PanelV2(props: { ctx: TuiPluginNs.Context; sessionID: string }) {
	const { ctx } = props;
	const current = () => ctx.data.session.get(props.sessionID)?.model;
	const rows = useRows(
		() => current()?.id,
		() => current()?.providerID,
		() => props.sessionID,
	);
	return (
		<Panel
			title={() => panelTitle(sessionKind(current()?.providerID))}
			rows={rows}
			colors={() => themed(hostColors(ctx.theme))}
		/>
	);
}

// Plain object, not `Plugin.define` — identity function there too.
export const commandCodeTui: TuiPluginNs.Definition = {
	id: ID,
	setup(ctx) {
		ctx.ui.slot({
			append: "sidebar.content",
			render: (input) => <PanelV2 ctx={ctx} sessionID={input.sessionID} />,
		});
		// /cmd-usage prints the full cmduse dashboard in a dialog. keymap.layer()
		// must run inside a render, so mount a no-op and register from there.
		// Return `void` like opencode's own /btw claim: a `null` render leaves an
		// empty box that paints a stray line in the prompt area.
		ctx.ui.slot({
			append: "app",
			render: (() => {
				ctx.keymap.layer(() => ({
					mode: "global",
					priority: 10,
					commands: [
						{
							id: "command-code.cmd-usage",
							title: "Command Code usage",
							group: "Command Code",
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
										message:
											error instanceof Error ? error.message : String(error),
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
					],
					bindings: ["command-code.cmd-usage"],
				}));
			}) as unknown as () => JSX.Element,
		});
	},
};

export default { ...commandCodeTui, tui };
