/** @jsxImportSource @opentui/solid */
// Sidebar panel: the row list plus the host-theme colours it draws with.
//
// Rows stay pure data (see rows.ts) and carry a `tone`; this module is the only
// place that knows how a tone becomes an RGBA, so both TUI hosts share it.
import { RGBA } from "@opentui/core";
import { For, Show } from "solid-js";
import { parts, type SidebarRow, type Tone } from "./rows";

/** One colour per row tone. */
export type PanelColors = Readonly<Record<Tone, RGBA>>;

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

/** v2 host theme -> panel colours. 400 is the accent step for on-background UI. */
export function hostColors(theme: HostTheme): PanelColors {
	return {
		base: theme.text.base,
		muted: theme.text.muted,
		accent: theme.hue?.accent?.[400] ?? theme.text.base,
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
		accent: RGBA.fromValues(0.55, 0.7, 1, 1),
		ok: RGBA.fromValues(0.4, 0.85, 0.5, 1),
		warn: RGBA.fromValues(0.95, 0.75, 0.3, 1),
		crit: RGBA.fromValues(0.95, 0.45, 0.45, 1),
	};
}

/** Bold title, then one line per row. Renders nothing when there are no rows. */
export function Panel(props: {
	rows: () => SidebarRow[];
	colors: () => PanelColors;
}) {
	return (
		<Show when={props.rows().length > 0}>
			<box>
				<text fg={props.colors().accent}>
					<b>Command Code</b>
				</text>
				<For each={props.rows()}>
					{(row) => (
						<text fg={props.colors()[row[2] ?? "base"]}>
							{parts(row).join("")}
						</text>
					)}
				</For>
			</box>
		</Show>
	);
}
