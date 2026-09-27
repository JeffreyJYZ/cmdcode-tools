/** @jsxImportSource @opentui/solid */
// Sidebar panel: the row list plus the host-theme colours it draws with.
//
// Rows stay pure data (see rows.ts) and carry a `tone`; this module is the only
// place that knows how a tone becomes an RGBA, so both TUI hosts share it.
//
// Only text tokens are read (`text.base` / `text.muted` / `text.feedback.*`).
// The theme's `hue` scales are widget colours — `hue.interactive[400]` is a dull
// orange-brown (#b67c56) in the default dark theme — so using them for rows
// painted the panel dark orange. `info` is the cyan mpc and cmduse use for
// figures.
import { RGBA } from "@opentui/core";
import { For, Show } from "solid-js";
import { parts, type SidebarRow, type Tone } from "./rows";

/** One colour per row tone, plus the two label colours (plain rows, headlines). */
export type PanelColors = Readonly<Record<Tone, RGBA>> & {
	readonly label: RGBA;
	readonly headline: RGBA;
};

/**
 * The slice of the v2 host theme the panel reads. `@opencode/theme` is not a
 * dependency here (the host rewrites its own module instances in), so the shape
 * is declared structurally — and read defensively, since the theme package has
 * renamed tokens before (`text.default` -> `text.base`).
 */
export interface HostTheme {
	readonly text: {
		readonly base: RGBA;
		readonly muted: RGBA;
		readonly feedback: Readonly<
			Record<"success" | "warning" | "error" | "info", { readonly base: RGBA }>
		>;
	};
	readonly hue?: {
		readonly accent?: Readonly<Record<number, RGBA>>;
	};
}

/**
 * v2 host theme -> panel colours. `mode` matters for one thing: the accent hue
 * is a usable purple in dark themes (#9d7cd8) but a peach in light ones, so the
 * headline shade is only taken from it in dark mode. A lighter cyan was tried
 * first and failed: terminals fold one-step-apart cyans onto the same ANSI
 * colour, so the headline rows read identical to the rest.
 */
export function hostColors(
	theme: HostTheme,
	mode: "dark" | "light" = "dark",
): PanelColors {
	return {
		base: theme.text.base,
		muted: theme.text.muted,
		// Bold is the emphasis; `strong` shares the plain text colour so the
		// model name never borrows a chromatic token.
		strong: theme.text.base,
		label: theme.text.feedback.info.base,
		headline:
			mode === "dark"
				? (theme.hue?.accent?.[200] ?? theme.text.feedback.info.base)
				: theme.text.feedback.info.base,
		ok: theme.text.feedback.success.base,
		warn: theme.text.feedback.warning.base,
		crit: theme.text.feedback.error.base,
	};
}

/** v1 hosts expose only a text/muted pair, so the semantic roles are literals. */
export function legacyColors(theme: {
	text: RGBA;
	textMuted: RGBA;
}): PanelColors {
	return {
		base: theme.text,
		muted: theme.textMuted,
		strong: theme.text,
		label: RGBA.fromValues(0.34, 0.71, 0.76, 1),
		headline: RGBA.fromValues(0.62, 0.49, 0.85, 1),
		ok: RGBA.fromValues(0.5, 0.85, 0.56, 1),
		warn: RGBA.fromValues(0.96, 0.65, 0.26, 1),
		crit: RGBA.fromValues(0.88, 0.42, 0.46, 1),
	};
}

/**
 * opentui styles a text-node span through `style` (`<span style={{ fg }}>`, as
 * opencode's own v2 UI does), yet types the prop as an empty bag. Passing `fg`
 * directly is silently ignored — the run then inherits no colour at all, which
 * is how the panel briefly lost every colour. Verified against the installed
 * opentui in test/sidebar-panel.test.ts.
 */
const spanStyle = (fg: RGBA): { style: { fg: RGBA } } =>
	({ style: { fg } }) as unknown as { style: { fg: RGBA } };

/**
 * A headline row (the plan, the active model) is drawn whole in one shade: its
 * label and its value share the colour, rather than the label being tinted alone.
 */
const rowColors = (
	colors: PanelColors,
	row: SidebarRow,
): { label: RGBA; value: RGBA } =>
	row[3]
		? { label: colors.headline, value: colors.headline }
		: { label: colors.label, value: colors[row[2] ?? "base"] };

/** One row: a bold label, then its value in the row's tone. */
function Row(props: { row: SidebarRow; colors: PanelColors }) {
	const [label, value] = parts(props.row);
	const tone = props.row[2] ?? "base";
	const fg = rowColors(props.colors, props.row);
	if (!value) {
		return <text fg={props.colors.muted}>{label}</text>;
	}
	return (
		<text>
			<span {...spanStyle(fg.label)}>
				<b>{label}</b>
			</span>
			<span {...spanStyle(fg.value)}>
				{tone === "strong" ? <b>{value}</b> : value}
			</span>
		</text>
	);
}

/** Bold title, then one line per row. Renders nothing when there are no rows. */
export function Panel(props: {
	rows: () => SidebarRow[];
	colors: () => PanelColors;
}) {
	return (
		<Show when={props.rows().length > 0}>
			<box>
				<text fg={props.colors().base}>
					<b>Command Code</b>
				</text>
				<For each={props.rows()}>
					{(row) => <Row row={row} colors={props.colors()} />}
				</For>
			</box>
		</Show>
	);
}
