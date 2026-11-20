import { clip } from "#~/view/text/format.ts";

/** Index just past an SGR sequence starting at `i`, else `i` itself. */
function ansiEnd(text: string, i: number): number {
	if (text[i] !== "\u001b" || text[i + 1] !== "[") return i;
	let j = i + 2;
	while (j < text.length) {
		const code = text.charCodeAt(j);
		if (code >= 0x30 && code <= 0x3b) {
			j += 1;
			continue;
		}
		break;
	}
	return text[j] === "m" ? j + 1 : i;
}

/** Length once ANSI colour is ignored. */
export function visibleLength(text: string): number {
	let visible = 0;
	for (let i = 0; i < text.length;) {
		const skipped = ansiEnd(text, i);
		if (skipped > i) {
			i = skipped;
			continue;
		}
		visible += 1;
		i += 1;
	}
	return visible;
}

export function stripAnsi(text: string): string {
	let out = "";
	for (let i = 0; i < text.length;) {
		const skipped = ansiEnd(text, i);
		if (skipped > i) {
			i = skipped;
			continue;
		}
		out += text[i] ?? "";
		i += 1;
	}
	return out;
}

/**
 * A rendered table line fits or it does not. One that must be cut loses its
 * colour rather than being sliced mid-escape, which would bleed it into the
 * next line.
 */
export function fitLine(text: string, width: number): string {
	if (visibleLength(text) <= width) return text;
	return clip(stripAnsi(text), width);
}
