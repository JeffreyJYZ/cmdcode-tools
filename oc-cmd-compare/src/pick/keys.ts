/**
 * Decode raw-mode stdin bytes into picker keys.
 *
 * An arrow key is a three-byte CSI/SS3 sequence and the terminal may hand it
 * over one byte at a time, so an unfinished escape is returned in `rest`
 * instead of being read as "Esc then [". `final` says no more bytes are coming
 * for this burst: only then is a lone `\x1b` a real Esc.
 */
export type PickKey =
	| { type: "text"; text: string }
	| { type: "backspace" }
	| { type: "up" }
	| { type: "down" }
	| { type: "enter" }
	| { type: "cancel" }
	| { type: "eof" }
	| { type: "ignored" };

export interface Decoded {
	keys: PickKey[];
	/** Bytes of an unfinished escape sequence, to prepend to the next read. */
	rest: string;
}

const ESC = "\u001b";

/** Decode one read. `final` flushes a pending escape as a real Esc. */
export function decodeKeys(input: string, final = false): Decoded {
	const keys: PickKey[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i] ?? "";
		if (ch === ESC) {
			const next = input[i + 1];
			if (next === undefined) {
				if (!final) return { keys, rest: input.slice(i) };
				keys.push({ type: "cancel" });
				return { keys, rest: "" };
			}
			if (next === "[" || next === "O") {
				// A CSI/SS3 sequence ends on one byte in 0x40..0x7e.
				let j = i + 2;
				while (j < input.length) {
					const code = input.charCodeAt(j);
					if (code >= 0x40 && code <= 0x7e) break;
					j += 1;
				}
				if (j >= input.length) {
					if (!final) return { keys, rest: input.slice(i) };
					keys.push({ type: "ignored" });
					return { keys, rest: "" };
				}
				const last = input[j];
				if (last === "A") keys.push({ type: "up" });
				else if (last === "B") keys.push({ type: "down" });
				else keys.push({ type: "ignored" });
				i = j + 1;
				continue;
			}
			// Esc followed by another key: the Esc itself is the key, and the
			// following byte is decoded on its own.
			keys.push({ type: "cancel" });
			i += 1;
			continue;
		}
		const code = ch.charCodeAt(0);
		if (ch === "\u0003") keys.push({ type: "cancel" });
		else if (ch === "\u0004") keys.push({ type: "eof" });
		else if (ch === "\r" || ch === "\n") keys.push({ type: "enter" });
		else if (ch === "\u007f" || ch === "\u0008") keys.push({ type: "backspace" });
		else if (code >= 0x20 && code <= 0x7e) keys.push({ type: "text", text: ch });
		else keys.push({ type: "ignored" });
		i += 1;
	}
	return { keys, rest: "" };
}
