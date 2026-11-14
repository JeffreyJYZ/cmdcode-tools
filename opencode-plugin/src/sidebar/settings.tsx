/** @jsxImportSource @opentui/solid */
// /cmd-settings dialog: one row per sidebar preference, cycling the labels
// settings-rows.ts owns. Modelled on opencode-wallpapers' Picker: the modal
// keymap layer lives in the component body, so it dies with the dialog instead
// of swallowing arrow keys in the prompt afterwards.
//
// Colours come from the theme's `dialog` surface when the host exposes one,
// and follow opencode's own DialogSelect: primary title, secondary value over
// an action-primary band. The `hue` scales are widget colours, not chrome.
import { RGBA } from "@opentui/core";
import type { Plugin as TuiPluginNs } from "@opencode/plugin/tui";
import { createSignal, For, onMount } from "solid-js";
import { loadPrefs, type Prefs, savePrefs } from "./prefs";
import { type SettingRow, settingRows } from "./settings-rows";

/** The slice of theme chrome the dialog draws with, read defensively. */
interface ThemeView {
	readonly text: {
		readonly base: RGBA;
		readonly muted: RGBA;
		readonly action?: Readonly<Record<"primary" | "secondary", { readonly focused?: RGBA }>>;
	};
	readonly background?: {
		readonly raised?: { readonly base?: RGBA };
		readonly action?: Readonly<Record<"primary", { readonly focused?: RGBA }>>;
	};
}

interface DialogColors {
	/** Row title when it is not the selection. */
	readonly base: RGBA;
	/** Every value not under the cursor, and the footer hints. */
	readonly muted: RGBA;
	/** Selected row's title. */
	readonly accent: RGBA;
	/** Selected row's value: native lists use the secondary tone, not the accent. */
	readonly secondary: RGBA;
	/** Focused row's background band. */
	readonly selected: RGBA;
}

/** `surface` is typed as required on ResolvedTheme, but a host may not carry it. */
function dialogTheme(ctx: TuiPluginNs.Context): ThemeView {
	const theme = ctx.theme as unknown as ThemeView & {
		readonly surface?: (name: string) => ThemeView;
	};
	return typeof theme.surface === "function" ? theme.surface("dialog") : theme;
}

function dialogColors(ctx: TuiPluginNs.Context): DialogColors {
	const view = dialogTheme(ctx);
	return {
		base: view.text.base,
		muted: view.text.muted,
		accent: view.text.action?.primary?.focused ?? view.text.base,
		// Matches opencode's own DialogSelect: an active row is a primary title over
		// a secondary value, so both in the accent read as one loud block.
		secondary: view.text.action?.secondary?.focused ?? view.text.muted,
		selected:
			view.background?.action?.primary?.focused ??
			view.background?.raised?.base ??
			RGBA.fromInts(0, 0, 0, 0),
	};
}

/** One row: title left, `‹ value ›` right, a band under the cursor. */
function Row(props: {
	row: SettingRow;
	colors: DialogColors;
	active: () => boolean;
	onClick: () => void;
}) {
	return (
		<box
			flexDirection="row"
			gap={1}
			paddingLeft={5}
			paddingRight={6}
			backgroundColor={props.active() ? props.colors.selected : RGBA.fromInts(0, 0, 0, 0)}
			onMouseUp={props.onClick}
		>
			<text flexGrow={1} fg={props.active() ? props.colors.accent : props.colors.base}>
				<b>{props.row.title}</b>
			</text>
			<text fg={props.active() ? props.colors.secondary : props.colors.muted}>
				{props.active() ? `‹ ${props.row.value()} ›` : props.row.value()}
			</text>
		</box>
	);
}

export function SettingsDialog(props: { ctx: TuiPluginNs.Context }) {
	const { ctx } = props;
	const colors = dialogColors(ctx);
	// Initialise from disk once, then trust the signal: `loadPrefs` reads the
	// file (or a short cache) and a per-render read would hit the disk on every
	// keystroke of a streaming session.
	const [prefs, setPrefs] = createSignal<Prefs>(loadPrefs());
	const save = (patch: Partial<Prefs>) => {
		savePrefs(patch);
		// Re-read rather than patch in memory: `savePrefs` also normalises an
		// unknown value back to the default, so the dialog must show what landed.
		setPrefs(loadPrefs());
	};
	const rows = settingRows(prefs, save);
	const visible = () => rows.filter((row) => !row.hidden?.());
	const [index, setIndex] = createSignal(0);
	const current = () => visible()[index()] ?? visible()[0];

	// Native list dialogs open at the large size; the host default is smaller and
	// left the description wrapping into a ragged block.
	onMount(() => {
		try {
			ctx.ui.dialog.set({ size: "large" });
		} catch {
			// older host without a resizable dialog: the default size still works
		}
	});

	const move = (direction: number) => {
		const list = visible();
		const length = list.length;
		if (length === 0) return;
		setIndex((at) => (at + direction + length) % length);
	};
	const change = (direction: number) => {
		const row = current();
		if (!row) return;
		const values = row.values();
		if (values.length === 0) return;
		const at = values.indexOf(row.value());
		const next = values[(at + direction + values.length) % values.length];
		if (next !== undefined) row.set(next);
	};

	// Created in the component body (like the wallpaper Picker) so the layer is
	// disposed with the dialog: a modal layer outliving its dialog swallows
	// every arrow key in the prompt.
	ctx.keymap.layer(() => ({
		mode: "modal",
		commands: [
			{ bind: "up", title: "Previous setting", group: "Command Code", run: () => move(-1) },
			{ bind: "down", title: "Next setting", group: "Command Code", run: () => move(1) },
			{ bind: "right", title: "Next value", group: "Command Code", run: () => change(1) },
			{ bind: "return", title: "Next value", group: "Command Code", run: () => change(1) },
			{ bind: "left", title: "Previous value", group: "Command Code", run: () => change(-1) },
			{
				bind: "escape",
				title: "Close settings",
				group: "Command Code",
				run: () => ctx.ui.dialog.clear(),
			},
		],
	}));

	return (
		<box flexDirection="column" gap={1} paddingBottom={1}>
			<box
				flexDirection="row"
				justifyContent="space-between"
				paddingLeft={5}
				paddingRight={6}
			>
				<text fg={colors.base}>
					<b>Command Code settings</b>
				</text>
				<text fg={colors.muted} onMouseUp={() => ctx.ui.dialog.clear()}>
					esc
				</text>
			</box>
			<For each={visible()}>
				{(row, at) => (
					<Row
						row={row}
						colors={colors}
						active={() => at() === index()}
						onClick={() => {
							setIndex(at());
							change(1);
						}}
					/>
				)}
			</For>
			<box paddingLeft={5} paddingRight={6}>
				<text fg={colors.muted} wrapMode="word">
					{(() => {
						const row = current();
						return row?.describe?.(row.value()) ?? "";
					})()}
				</text>
			</box>
			<box flexDirection="row" gap={2} paddingLeft={5} paddingRight={6}>
				<text fg={colors.muted}>{"↑/↓ setting"}</text>
				<text fg={colors.muted}>{"enter ←/→ change"}</text>
			</box>
		</box>
	);
}
