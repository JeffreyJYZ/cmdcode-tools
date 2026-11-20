/**
 * Decode a Next.js page's streamed RSC payload. Each chunk is a JSON string
 * literal inside `self.__next_f.push([1,"…"])`; joining the decoded strings
 * yields the flight text the page renders from, with plain `"key":`
 * keys instead of the `\"`-escaped form seen in the raw HTML.
 */
export function decodeFlight(html: string): string {
	const chunks: string[] = [];
	const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
	for (const match of html.matchAll(re)) {
		try {
			chunks.push(JSON.parse(match[1] ?? '""') as string);
		} catch {
			// A chunk we cannot read as a JSON string is skipped.
		}
	}
	return chunks.join("");
}

/** The JSON array value of `"key"` in `text`, bracket-matched string-aware. */
export function readArray(text: string, key: string): unknown[] | null {
	const at = text.indexOf(`"${key}":`);
	if (at < 0) return null;
	const open = text.indexOf("[", at);
	if (open < 0) return null;
	let depth = 0;
	let inString = false;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (char === "\\") i++;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "[") depth++;
		else if (char === "]") {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(text.slice(open, i + 1)) as unknown[];
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}
