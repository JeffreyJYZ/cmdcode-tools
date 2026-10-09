import { ANSI } from "#~/constants/ansi.ts";

let colored = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function setColorMode(on: boolean): void {
	colored = on;
}

function wrap(code: string, text: string): string {
	return colored ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const bold = (text: string): string => wrap("1", text);
export const dim = (text: string): string => wrap("2", text);

/** Pad to a visible width, truncating with an ellipsis rather than wrapping. */
export function pad(
	text: string,
	width: number,
	align: "left" | "right" = "left",
): string {
	const visible = text.replace(ANSI, "").length;
	if (visible > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
	const fill = " ".repeat(width - visible);
	return align === "right" ? fill + text : text + fill;
}

export function fmtCount(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	if (n >= 10) return n.toFixed(0);
	return n.toFixed(1);
}

/** A count that is a count: `9 asks`, never `9.0 asks`, and grouped when long. */
export function fmtInt(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** The vendor prefix is noise in a report about shape: `deepseek/deepseek-v4.1-flash`. */
export function prettyModel(id: string): string {
	const trimmed = id.trim();
	const slash = trimmed.indexOf("/");
	return slash === -1 ? trimmed || "unknown" : trimmed.slice(slash + 1);
}

/** Fixed-point and trailing-zero trimmed; scientific notation reads terribly here. */
export function fmtUsd(n: number): string {
	if (n === 0) return "free";
	if (!Number.isFinite(n)) return "∞";
	const digits = n >= 0.01 ? 4 : n >= 1e-6 ? 8 : 11;
	return `$${n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function fmtDate(ms: number): string {
	if (!ms) return "—";
	return new Date(ms).toISOString().slice(0, 10);
}

/** `1.2K/21K` — a percentile pair. */
export function fmtPair(low: number, high: number): string {
	return `${fmtCount(low)}/${fmtCount(high)}`;
}
