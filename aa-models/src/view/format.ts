/** Number/text formatting shared by the table renderer and the help text. */

/** Printed for a value AA does not publish. Never `0`, never a blank cell. */
export const EMPTY = "—";

/** The renderer's own escapes. Local on purpose: nothing else may emit SGR. */
export const SGR = {
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	reset: "\x1b[0m",
} as const;

export type ColorMode = "auto" | "always" | "never";

/** `--color` + `NO_COLOR` + tty, resolved in one place. */
export function colorEnabled(mode: ColorMode, isTty: boolean, noColor: boolean): boolean {
	if (noColor) return false;
	if (mode === "never") return false;
	if (mode === "always") return true;
	return isTty;
}

export function paint(text: string, sgr: string, on: boolean): string {
	return on && text !== "" ? `${sgr}${text}${SGR.reset}` : text;
}

/** Fixed-point that never prints `-0` or `-0.0`. */
function fixed(n: number, digits: number): string {
	const text = n.toFixed(digits);
	return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/** An index or score: one decimal. */
export function fmtScore(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return EMPTY;
	return fixed(n, 1);
}

/** Median output tokens/second: one decimal. */
export function fmtTps(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return EMPTY;
	return fixed(n, 1);
}

/** Latency in seconds: two decimals, because sub-second precision is the point. */
export function fmtSeconds(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return EMPTY;
	return fixed(n, 2);
}

/** Token counts read as `200K` / `1.0M`; never scientific notation. */
export function fmtCount(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return EMPTY;
	const abs = Math.abs(n);
	if (abs >= 1e9) return `${fixed(n / 1e9, 1)}B`;
	if (abs >= 1e6) return `${fixed(n / 1e6, 1)}M`;
	if (abs >= 1e3) {
		const k = fixed(n / 1e3, 1);
		return `${k.endsWith(".0") ? k.slice(0, -2) : k}K`;
	}
	return String(Math.round(n));
}

/** A USD price per 1M tokens: `$0.15`, `$2.5`, `$0` for a free model. */
export function fmtPrice(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return EMPTY;
	const text = fixed(n, 3).replace(/0+$/, "").replace(/\.$/, "");
	return `$${text}`;
}

export function fmtDate(d: string | null): string {
	return d === null || d === "" ? EMPTY : d;
}

export function fmtOpen(open: boolean | null): string {
	if (open === null) return EMPTY;
	return open ? "open" : "closed";
}

/** Clip to `width`, marking the cut with `…` — never a silent cut. */
export function clip(text: string, width: number): string {
	if (width <= 0) return "";
	if (text.length <= width) return text;
	if (width === 1) return "…";
	return `${text.slice(0, width - 1)}…`;
}

export function pad(text: string, width: number, align: "left" | "right"): string {
	return align === "right" ? text.padStart(width) : text.padEnd(width);
}
