/** @jsxImportSource @opentui/solid */
// The /context dialog: a full-width stacked bar, the measured header, a column
// header, then one row per bucket (one per tool under Tool Outputs), delta.app's
// Context Window order. Layout is flexbox, not fixed-width strings, so it fills
// whatever width the host gives the dialog and the numeric columns stay aligned.
// Colours are fixed so the bar reads the same on any theme; row text uses the
// host theme's text tokens.
import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { For, Show } from "solid-js";
import type { Breakdown, Bucket } from "./breakdown";
import {
	CHILD_INDENT,
	CHILD_PALETTE,
	CHILD_TICK,
	MAX_CHILDREN,
	PALETTE,
	PCT_WIDTH,
	SIZE_WIDTH,
	TICK,
	TOKENS_WIDTH,
} from "./constants/dialog";
import { formatBytes, formatPercent, formatTokens } from "./format";

export interface DialogColors {
	readonly label: RGBA;
	readonly value: RGBA;
	readonly muted: RGBA;
}

/** Children to draw: the biggest MAX_CHILDREN, the tail rolled into one row. */
function childRows(bucket: Bucket): Bucket[] {
	if (bucket.children.length <= MAX_CHILDREN) return [...bucket.children];
	const shown = bucket.children.slice(0, MAX_CHILDREN - 1);
	const rest = bucket.children.slice(MAX_CHILDREN - 1);
	const hidden = rest.reduce(
		(total, child) => ({
			bytes: total.bytes + child.bytes,
			tokens: total.tokens + child.tokens,
		}),
		{ bytes: 0, tokens: 0 },
	);
	return [
		...shown,
		{
			key: `${bucket.key}:more`,
			label: `+${rest.length} more tools`,
			tone: "other",
			bytes: hidden.bytes,
			tokens: hidden.tokens,
			children: [],
		},
	];
}

function Bar(props: { breakdown: Breakdown }) {
	const segments = () => {
		const total = props.breakdown.totalBytes || 1;
		return props.breakdown.buckets.map((bucket) => ({
			tone: bucket.tone,
			// Relative weight to ~0.1% so a tiny bucket still shows a sliver.
			weight: Math.max(0.5, (bucket.bytes / total) * 1000),
		}));
	};
	return (
		<box flexDirection="row" width="100%" height={1}>
			<For each={segments()}>
				{(segment) => (
					<box
						flexGrow={segment.weight}
						height={1}
						backgroundColor={PALETTE[segment.tone]}
					/>
				)}
			</For>
		</box>
	);
}

function Row(props: {
	bucket: Bucket;
	total: number;
	colors: DialogColors;
	accent: RGBA;
	child?: boolean;
}) {
	return (
		<box flexDirection="row" width="100%">
			<text fg={props.accent}>{props.child ? CHILD_TICK : TICK}</text>
			<text fg={props.child ? props.colors.muted : props.colors.label}>
				{props.child ? CHILD_INDENT : ""}
				{/* NBSP, not a space: opentui drops the ASCII space glyph when the
				 * text node sits in a flex row, and the cell then captures/renders
				 * a stray character (e.g. "Thinking Blocks" -> "ThinkingoBlocks").
				 * A non-breaking space lays out identically and is painted. */}
				{props.bucket.label.replace(/ /g, "\u00a0")}
			</text>
			<box flexGrow={1} flexDirection="row" />
			<text fg={props.colors.muted}>
				{formatTokens(props.bucket.tokens).padStart(TOKENS_WIDTH)}
			</text>
			<text fg={props.colors.value}>
				{"  "}
				{formatBytes(props.bucket.bytes).padStart(SIZE_WIDTH)}
			</text>
			<text fg={props.colors.muted}>
				{"  "}
				{formatPercent(props.bucket.bytes, props.total).padStart(PCT_WIDTH)}
			</text>
		</box>
	);
}

function ColumnHeader(props: { colors: DialogColors }) {
	return (
		<box flexDirection="row" width="100%">
			<text fg={props.colors.muted}>{"  Category"}</text>
			<box flexGrow={1} flexDirection="row" />
			<text fg={props.colors.muted}>{"tokens".padStart(TOKENS_WIDTH)}</text>
			<text fg={props.colors.muted}>
				{"  "}
				{"size".padStart(SIZE_WIDTH)}
			</text>
			<text fg={props.colors.muted}>
				{"  "}
				{"share".padStart(PCT_WIDTH)}
			</text>
		</box>
	);
}

export function BreakdownDialog(props: {
	breakdown: Breakdown;
	colors: DialogColors;
	title?: string;
}): JSX.Element {
	const header = () => {
		const used =
			props.breakdown.measuredTokens !== undefined
				? formatTokens(props.breakdown.measuredTokens)
				: "?";
		const cap =
			props.breakdown.limit !== undefined
				? formatTokens(props.breakdown.limit)
				: "?";
		return `${used} / ${cap}`;
	};
	// One flat list so rows render in a single For.
	const rows = () =>
		props.breakdown.buckets.flatMap((bucket) => {
			const parent = { bucket, child: false, accent: PALETTE[bucket.tone] };
			const kids = childRows(bucket).map((entry, index) => ({
				bucket: entry,
				child: true,
				accent: entry.key.endsWith(":more")
					? props.colors.muted
					: (CHILD_PALETTE[index % CHILD_PALETTE.length] ?? PALETTE.outputs),
			}));
			return [parent, ...kids];
		});
	return (
		<box
			flexDirection="column"
			width="100%"
			paddingLeft={2}
			paddingRight={2}
			paddingBottom={1}
		>
			<text fg={props.colors.muted}>Context Window</text>
			<box height={1} />
			<Bar breakdown={props.breakdown} />
			<box height={1} />
			<box flexDirection="row" width="100%" justifyContent="space-between">
				<text fg={props.colors.value}>
					<b>{header()}</b>
				</text>
				<Show when={props.breakdown.percent !== undefined}>
					<text fg={props.colors.muted}>{props.breakdown.percent}% used</text>
				</Show>
			</box>
			<box height={1} />
			<Show
				when={props.breakdown.buckets.length > 0}
				fallback={<text fg={props.colors.muted}>no context to show yet</text>}
			>
				<ColumnHeader colors={props.colors} />
				<For each={rows()}>
					{(row) => (
						<Row
							bucket={row.bucket}
							total={props.breakdown.totalBytes}
							colors={props.colors}
							accent={row.accent}
							child={row.child}
						/>
					)}
				</For>
			</Show>
			<box height={1} />
			<box flexDirection="row" width="100%" justifyContent="flex-end">
				<text fg={props.colors.muted}>esc close</text>
			</box>
		</box>
	);
}
