import { describe, expect, test } from "bun:test";
import { decodeKeys } from "#~/pick/keys.ts";

const kinds = (input: string, final = false): string =>
	decodeKeys(input, final)
		.keys.map((key) => key.type)
		.join(",");

describe("decodeKeys", () => {
	test("printable characters are text, one key each", () => {
		const out = decodeKeys("abc");
		expect(out.keys).toEqual([
			{ type: "text", text: "a" },
			{ type: "text", text: "b" },
			{ type: "text", text: "c" },
		]);
		expect(out.rest).toBe("");
		expect(decodeKeys(" `").keys).toEqual([
			{ type: "text", text: " " },
			{ type: "text", text: "`" },
		]);
	});

	test("editing and control keys", () => {
		expect(kinds("\u007f")).toBe("backspace");
		expect(kinds("\u0008")).toBe("backspace");
		expect(kinds("\r")).toBe("enter");
		expect(kinds("\n")).toBe("enter");
		expect(kinds("\u0003")).toBe("cancel");
		expect(kinds("\u0004")).toBe("eof");
	});

	test("both arrow encodings", () => {
		expect(kinds("\u001b[A")).toBe("up");
		expect(kinds("\u001b[B")).toBe("down");
		expect(kinds("\u001bOA")).toBe("up");
		expect(kinds("\u001bOB")).toBe("down");
	});

	test("an unknown sequence is ignored, not read as Esc", () => {
		expect(kinds("\u001b[3~")).toBe("ignored");
	});

	test("a sequence delivered one byte at a time is still one arrow", () => {
		let pending = "";
		const keys = [];
		for (const byte of "\u001b[B") {
			const decoded = decodeKeys(pending + byte);
			pending = decoded.rest;
			keys.push(...decoded.keys);
		}
		expect(pending).toBe("");
		expect(keys).toEqual([{ type: "down" }]);
	});

	test("an incomplete escape waits instead of turning into Esc", () => {
		const first = decodeKeys("\u001b");
		expect(first.keys).toEqual([]);
		expect(first.rest).toBe("\u001b");
		const second = decodeKeys(`${first.rest}[A`);
		expect(second.keys).toEqual([{ type: "up" }]);
		expect(second.rest).toBe("");
	});

	test("a final flush makes a lone escape a real Esc", () => {
		expect(kinds("\u001b", true)).toBe("cancel");
		expect(kinds("\u001b[", true)).toBe("ignored");
	});

	test("Esc followed by a letter cancels and keeps the letter", () => {
		const out = decodeKeys("\u001bq");
		expect(out.keys).toEqual([{ type: "cancel" }, { type: "text", text: "q" }]);
	});
});
