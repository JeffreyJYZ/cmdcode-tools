import { LABEL } from "#~/constants/layout.ts";
import type { DropCount, Shape, Side } from "#~/types.ts";
import {
	bold,
	dim,
	fmtCount,
	fmtDate,
	fmtInt,
	fmtPair,
	pad,
	prettyModel,
} from "./format.ts";

export function block(label: string, lines: string[]): string[] {
	return lines.map((line, index) =>
		index === 0
			? `${bold(pad(label, LABEL))}${line}`
			: `${" ".repeat(LABEL)}${line}`,
	);
}

export function dropLines(drops: DropCount[], explain: boolean): string[] {
	if (drops.length === 0) return ["nothing"];
	const lines = drops.map((drop) => `${drop.reason} ${fmtInt(drop.asks)}`);
	if (explain) return lines;
	return [lines.slice(0, 6).join(dim(" · "))];
}

export function measured(shape: Shape): string[] {
	return [
		[
			`${bold(fmtInt(shape.asks))} asks`,
			`${fmtInt(shape.sessions)} sessions`,
			`${fmtInt(shape.projects)} projects`,
			`${fmtDate(shape.first)} → ${fmtDate(shape.last)}`,
		].join(dim(" · ")),
	];
}

export function perReq(shape: Shape, weight: "turn" | "session"): string[] {
	const { stats, perReq: req, perSession: session } = shape;
	return [
		[
			`input ${bold(fmtCount(req.input))}`,
			`output ${bold(fmtCount(req.output))}`,
			`reasoning ${fmtCount(req.reasoning)}`,
			`cache read ${bold(fmtCount(req.cacheRead))}`,
			`cache write ${fmtCount(req.cacheWrite)}`,
		].join(dim(" · ")),
		dim(
			[
				`p10/p90  input ${fmtPair(stats.input.p10, stats.input.p90)}`,
				`output ${fmtPair(stats.output.p10, stats.output.p90)}`,
				`cache read ${fmtPair(stats.cacheRead.p10, stats.cacheRead.p90)}`,
			].join(" · "),
		),
		dim(
			weight === "session"
				? "one vote per conversation, which is what the projection prices"
				: `one vote per conversation instead: cache read ${fmtCount(session.cacheRead)} · input ${fmtCount(session.input)} · output ${fmtCount(session.output)}`,
		),
	];
}

/** What each plan's own traffic looks like, which is what mpc prices per side. */
export function sides(shape: Shape): string[] {
	const names: Record<Side, string> = {
		oc: "OpenCode Go",
		cc: "CommandCode",
	};
	const lines = (["oc", "cc"] as const).flatMap((side) => {
		const measured = shape.sides[side];
		if (!measured) return [];
		const { profile, reqs } = measured;
		return [
			[
				`${pad(names[side], 12)}`,
				`input ${pad(fmtCount(profile.input), 8, "right")}`,
				`output ${pad(fmtCount(profile.output), 7, "right")}`,
				`cache read ${pad(fmtCount(profile.cacheRead), 9, "right")}`,
				dim(`${fmtInt(reqs)} reqs`),
			].join("  "),
		];
	});
	if (lines.length === 0) return [];
	return [dim("each side priced on its own traffic"), ...lines];
}

export function position(shape: Shape): string[] {
	if (shape.buckets.length === 0) return [];
	const rows = shape.buckets.map((bucket) =>
		[
			`pos ${pad(bucket.label, 7)}`,
			`cache read ${pad(fmtCount(bucket.cacheRead), 8, "right")}`,
			`input ${pad(fmtCount(bucket.input), 7, "right")}`,
			`output ${pad(fmtCount(bucket.output), 6, "right")}`,
			dim(`${fmtInt(bucket.reqs)} reqs`),
		].join("  "),
	);
	return [
		dim(
			"how far into its session the req sat — every call re-reads the context",
		),
		...rows,
	];
}

export function models(shape: Shape): string[] {
	if (shape.models.length === 0) return [];
	const rest = shape.models.length - 6;
	const line = shape.models
		.slice(0, 6)
		.map(
			(model) =>
				`${prettyModel(model.name)} ${dim(fmtCount(model.reqs))}`,
		)
		.join(dim(" · "));
	return [rest > 0 ? `${line}${dim(` …${rest} more`)}` : line];
}
