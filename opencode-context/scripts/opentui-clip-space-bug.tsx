/** @jsxImportSource @opentui/solid */
// Minimal repro for an @opentui clipping bug: when the frame is shorter than the
// content (so the renderer clips), a text node's ASCII space is painted as a
// stray glyph taken from the same string. Height-parity dependent:
//
//   h=20 BUG "ThinkingoBlocks"   h=21 ok   h=22 BUG   h=23 ok   h=24 BUG
//   h>=25 ok  (content fits at ~24 rows, nothing clipped)
//
// The stray glyph comes from the same string: "Think Blocks" -> "ThinksBlocks"
// ("s" from "Blocks"). NBSP (U+00A0) avoids it. This component is copied
// verbatim from the plugin's /context dialog; the only change is the label
// renders `bucket.label` instead of `bucket.label.replace(/ /g, "\u00a0")`.
//
//   bun run scripts/space-bug.tsx
import { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { For, Show } from "solid-js";

type Tone =
	| "thinking"
	| "outputs"
	| "system"
	| "inputs"
	| "user"
	| "assistant"
	| "toolDefs"
	| "other";
interface Bucket {
	readonly key: string;
	readonly label: string;
	readonly tone: Tone;
	readonly bytes: number;
	readonly tokens: number;
	readonly children: readonly Bucket[];
}
interface Breakdown {
	readonly buckets: readonly Bucket[];
	readonly totalBytes: number;
	readonly totalTokens?: number;
	readonly measuredTokens?: number;
	readonly limit?: number;
	readonly percent?: number;
}
const trim = (n: number) => {
	const s = n.toFixed(1);
	return s.endsWith(".0") ? s.slice(0, -2) : s;
};
const formatBytes = (n: number) =>
	n < 1024 ? `${Math.round(n)}B` : `${trim(n / 1024)}KB`;
const formatTokens = (n: number) =>
	n < 1000 ? String(n) : `${trim(n / 1000)}k`;
const formatPercent = (part: number, whole: number) =>
	whole <= 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;

const PALETTE: Record<Tone, RGBA> = {
	thinking: RGBA.fromValues(0.93, 0.69, 0.31, 1),
	outputs: RGBA.fromValues(0.87, 0.45, 0.5, 1),
	system: RGBA.fromValues(0.63, 0.67, 0.73, 1),
	inputs: RGBA.fromValues(0.4, 0.72, 0.75, 1),
	user: RGBA.fromValues(0.82, 0.67, 0.42, 1),
	assistant: RGBA.fromValues(0.67, 0.56, 0.9, 1),
	toolDefs: RGBA.fromValues(0.5, 0.62, 0.9, 1),
	other: RGBA.fromValues(0.55, 0.58, 0.62, 1),
};

/** Distinct hues for tool children, so sub-tools read apart (a lighter step of
 * the parent hue does not — see AGENTS.md). */
const CHILD_PALETTE: readonly RGBA[] = [
	RGBA.fromValues(0.87, 0.45, 0.5, 1),
	RGBA.fromValues(0.93, 0.69, 0.31, 1),
	RGBA.fromValues(0.47, 0.75, 0.6, 1),
	RGBA.fromValues(0.5, 0.62, 0.9, 1),
	RGBA.fromValues(0.67, 0.56, 0.9, 1),
	RGBA.fromValues(0.4, 0.72, 0.75, 1),
	RGBA.fromValues(0.82, 0.67, 0.42, 1),
	RGBA.fromValues(0.78, 0.55, 0.71, 1),
];

const TOKENS_WIDTH = 7;
const SIZE_WIDTH = 8;
const PCT_WIDTH = 6;
const TICK = "▌ ";
const CHILD_TICK = "▏ ";
const CHILD_INDENT = "  ";
/** Keep the dialog from growing past the tool count that fits, oldest shown. */
const MAX_CHILDREN = 8;

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
				{props.bucket.label}
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

// --- repro harness: the exact component above, with the ASCII space ---
import { testRender } from "@opentui/solid";

const child = (label: string, bytes: number, tokens: number): Bucket => ({
	key: `o:${label}`,
	label,
	tone: "outputs",
	bytes,
	tokens,
	children: [],
});
const sample: Breakdown = {
	measuredTokens: 209_400,
	limit: 1_000_000,
	percent: 21,
	totalBytes: 880_000,
	totalTokens: 220_000,
	buckets: [
		{
			key: "outputs",
			label: "Tool Outputs",
			tone: "outputs",
			bytes: 358_000,
			tokens: 89_000,
			children: [
				child("read", 259_900, 65_000),
				child("shell", 95_200, 23_800),
				child("write", 1_200, 300),
				child("execute", 807, 202),
				child("edit", 667, 167),
				child("question", 239, 60),
			],
		},
		{
			key: "thinking",
			label: "Thinking Blocks",
			tone: "thinking",
			bytes: 239_500,
			tokens: 59_900,
			children: [],
		},
		{
			key: "inputs",
			label: "Tool Inputs",
			tone: "inputs",
			bytes: 84_700,
			tokens: 21_200,
			children: [],
		},
		{
			key: "checkpoint",
			label: "Conversation Checkpoint",
			tone: "other",
			bytes: 76_700,
			tokens: 19_200,
			children: [],
		},
		{
			key: "system",
			label: "System Prompt",
			tone: "system",
			bytes: 52_100,
			tokens: 13_000,
			children: [],
		},
		{
			key: "user",
			label: "User Messages",
			tone: "user",
			bytes: 48_200,
			tokens: 12_100,
			children: [],
		},
		{
			key: "toolDefs",
			label: "Tool Definitions",
			tone: "toolDefs",
			bytes: 11_800,
			tokens: 3_000,
			children: [],
		},
		{
			key: "assistant",
			label: "Assistant Prose",
			tone: "assistant",
			bytes: 8_900,
			tokens: 2_200,
			children: [],
		},
		{
			key: "other",
			label: "Other",
			tone: "other",
			bytes: 51,
			tokens: 13,
			children: [],
		},
	],
};

async function run(height: number) {
	const setup = await testRender(
		() => (
			<BreakdownDialog
				breakdown={sample}
				colors={{
					label: RGBA.fromValues(0.6, 0.6, 0.6, 1),
					value: RGBA.fromValues(0.95, 0.95, 0.95, 1),
					muted: RGBA.fromValues(0.6, 0.6, 0.6, 1),
				}}
			/>
		),
		{ width: 88, height },
	);
	await setup.renderOnce();
	for (const line of setup.captureCharFrame().split("\n")) {
		if (!line.includes("Think")) continue;
		console.log(
			`h=${height} ${line.includes("Thinking Blocks") ? "ok " : "BUG"} ${JSON.stringify(line.trimEnd())}`,
		);
	}
}
for (let height = 20; height <= 30; height++) await run(height);
process.exit(0);
