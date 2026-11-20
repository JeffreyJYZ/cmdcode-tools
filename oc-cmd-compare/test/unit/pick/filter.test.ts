import { describe, expect, test } from "bun:test";
import { applyKey, filterRows, initialPickState, selectedRow } from "#~/pick/filter.ts";
import type { PickKey } from "#~/pick/keys.ts";
import { row } from "../fixtures.ts";

const rows = [
	row("deepseek v4.1 flash", 1, 2),
	row("kimi k3", 1, 2),
	row("qwen3.8-max", undefined, 2),
];

describe("filterRows", () => {
	test("an empty query keeps every row in the table's order", () => {
		expect(filterRows(rows, "")).toEqual(rows);
	});

	test("substring over name and key, case-insensitive", () => {
		expect(filterRows(rows, "KIMI").map((r) => r.name)).toEqual(["kimi k3"]);
		expect(filterRows(rows, "3.8").map((r) => r.name)).toEqual(["qwen3.8-max"]);
		expect(filterRows(rows, "flash").map((r) => r.name)).toEqual(["deepseek v4.1 flash"]);
	});

	test("a key hit that the display name does not carry still matches", () => {
		const keyed = { ...row("DeepSeek V4.1 Flash", 1, 2), key: "deepseekv41flash" };
		expect(filterRows([keyed], "v41flash")).toHaveLength(1);
	});

	test("a prefix outranks a mid-word hit; ties keep the metric order", () => {
		const list = [row("openai/gpt-6", 1, 2), row("gpt-6-mini", 1, 2), row("gpt-6-nano", 1, 2)];
		expect(filterRows(list, "gpt").map((r) => r.name)).toEqual([
			"gpt-6-mini",
			"gpt-6-nano",
			"openai/gpt-6",
		]);
	});

	test("a word start outranks a hit inside a word", () => {
		const list = [row("superflash", 1, 2), row("glm flash-x", 1, 2)];
		expect(filterRows(list, "flash").map((r) => r.name)).toEqual(["glm flash-x", "superflash"]);
	});

	test("typing a space or a backtick is just a query, never a throw", () => {
		expect(() => filterRows(rows, " ")).not.toThrow();
		expect(() => filterRows(rows, "`")).not.toThrow();
		expect(() => filterRows(rows, "(")).not.toThrow();
		expect(filterRows(rows, "`")).toEqual([]);
	});
});

const key = (type: PickKey["type"], text = ""): PickKey =>
	type === "text" ? { type, text } : ({ type } as PickKey);

describe("applyKey", () => {
	test("typing narrows and resets the selection", () => {
		const moved = { ...initialPickState(), selected: 2 };
		const next = applyKey(moved, key("text", "d"), 3);
		expect(next).toEqual({ query: "d", selected: 0, done: null });
	});

	test("backspace edits the query", () => {
		const state = { query: "kim", selected: 0, done: null };
		expect(applyKey(state, key("backspace"), 1).query).toBe("ki");
		expect(applyKey({ ...state, query: "" }, key("backspace"), 3).query).toBe("");
	});

	test("up and down clamp to the list", () => {
		const state = initialPickState();
		expect(applyKey(state, key("up"), 3).selected).toBe(0);
		expect(applyKey({ ...state, selected: 1 }, key("down"), 3).selected).toBe(2);
		expect(applyKey({ ...state, selected: 2 }, key("down"), 3).selected).toBe(2);
		expect(applyKey(state, key("down"), 0).selected).toBe(0);
	});

	test("enter chooses a row, and does nothing on an empty list", () => {
		const state = { ...initialPickState(), selected: 1 };
		expect(applyKey(state, key("enter"), 3).done).toBe("choose");
		expect(applyKey(state, key("enter"), 0).done).toBe(null);
		const chosen = selectedRow(applyKey(state, key("enter"), 3), filterRows(rows, ""));
		expect(chosen?.name).toBe("kimi k3");
	});

	test("esc, ctrl-c and ctrl-d quit", () => {
		expect(applyKey(initialPickState(), key("cancel"), 3).done).toBe("quit");
		expect(applyKey(initialPickState(), key("eof"), 3).done).toBe("quit");
	});

	test("j and k browse while the query is empty, and type once it is not", () => {
		expect(applyKey(initialPickState(), key("text", "j"), 3)).toEqual({
			query: "",
			selected: 1,
			done: null,
		});
		expect(applyKey(initialPickState(), key("text", "k"), 3).selected).toBe(0);
		expect(applyKey({ ...initialPickState(), query: "i" }, key("text", "j"), 3).query).toBe(
			"ij",
		);
		expect(filterRows(rows, "imi").map((r) => r.name)).toEqual(["kimi k3"]);
	});

	test("q quits only while the query is empty, so a q-model is still reachable", () => {
		expect(applyKey(initialPickState(), key("text", "q"), 3).done).toBe("quit");
		const typing = applyKey({ ...initialPickState(), query: "wen" }, key("text", "q"), 3);
		expect(typing).toEqual({ query: "wenq", selected: 0, done: null });
		expect(filterRows(rows, "wen").map((r) => r.name)).toEqual(["qwen3.8-max"]);
	});
});
