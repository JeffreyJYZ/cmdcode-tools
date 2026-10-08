/** Size formatting shared by the dialog and the markdown the tool returns.
 *
 * The size column follows delta.app's Context Window: one decimal, and the
 * `.0` dropped (`406.5KB`, `968k`, never `1.0MB`).
 */

const trim = (n: number): string => {
	const s = n.toFixed(1);
	return s.endsWith(".0") ? s.slice(0, -2) : s;
};

/** 415_744 -> "406KB"; 1024 -> "1KB". */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${Math.round(bytes)}B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${trim(kb)}KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${trim(mb)}MB`;
	return `${trim(mb / 1024)}GB`;
}

/** 173_140 -> "173.1k"; 968_000 -> "968k". */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	return `${trim(tokens / 1000)}k`;
}

/** One decimal, so a sub-0.05% row reads "0.0%" instead of "0%"; a full row stays "100%". */
export function formatPercent(part: number, whole: number): string {
	if (whole <= 0) return "0.0%";
	const value = (part / whole) * 100;
	if (value >= 99.95) return "100%";
	return `${value.toFixed(1)}%`;
}
