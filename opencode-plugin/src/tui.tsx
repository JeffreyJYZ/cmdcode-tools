/** @jsxImportSource @opentui/solid */
// OpenCode TUI half: a "Command Code" session-sidebar section (plan, rolling
// windows, period totals, plus the active model's allowance, rates and
// benchmarks), and — on v2 hosts — the slash commands (usage dashboards and the
// settings dialog, see tui-commands.tsx).
//
// Two hosts, two TUI contracts, one module (same shape cmd-provider uses):
//   v1  `tui(api)`             — `api.slots.register({ slots: { sidebar_content } })`
//   v2  `setup(context)`       — `context.ui.slot({ append: "sidebar.content" })`
// Data comes from two read-only spawns: cmduse for usage (polled) and mpc for
// the per-model catalog (disk-cached; it scrapes docs).

import type { Plugin as TuiPluginNs } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { TUI_ID } from "./constants/providers";
import { hostColors, legacyColors, mono, Panel, type PanelColors } from "./sidebar/panel";
import { loadPrefs } from "./sidebar/prefs";
import { panelTitle, sessionKind, useRows } from "./sidebar/useRows";
import { registerCommands } from "./tui-commands";

/** Colour is opt-in (see sidebar/prefs.ts); off, every tone collapses to text. */
const themed = (colors: PanelColors): PanelColors => (loadPrefs().colors ? colors : mono(colors));

// ---- v1 host ---------------------------------------------------------------

interface V1Api {
	slots: {
		register: (config: {
			order?: number;
			slots: {
				sidebar_content: (ctx: unknown, props: { session_id: string }) => unknown;
			};
		}) => void;
	};
	state: {
		session: {
			get: (id: string) => { model?: { providerID: string; id: string } } | undefined;
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
const tuiSetupSeen = new WeakSet<object>();

export const commandCodeTui: TuiPluginNs.Definition = {
	id: TUI_ID,
	setup(ctx) {
		if (tuiSetupSeen.has(ctx as object)) return;
		tuiSetupSeen.add(ctx as object);
		ctx.ui.slot({
			append: "sidebar.content",
			render: (input) => <PanelV2 ctx={ctx} sessionID={input.sessionID} />,
		});
		// keymap.layer() must run inside a render, so mount a no-op app slot and
		// register the commands from there. Return `void` like opencode's own
		// /btw claim: a `null` render leaves an empty box that paints a stray
		// line in the prompt area.
		ctx.ui.slot({
			append: "app",
			render: (() => registerCommands(ctx)) as unknown as () => JSX.Element,
		});
	},
};

export default { ...commandCodeTui, tui };
