import { describe, expect, test } from "bun:test";
import { tally } from "~/view/render.ts";
import { row } from "../fixtures.ts";

describe("tally", () => {
	test("counts head-to-head wins, ties and exclusives", () => {
		const t = tally([
			row("a", 1, 2), // oc wins
			row("b", 3, 2), // cc wins
			row("c", 2, 2), // tie
			row("d", 1), // oc only
			row("e", undefined, 1), // cc only
		]);
		expect(t).toEqual({
			headToHead: 3,
			ocWins: 1,
			ccWins: 1,
			ties: 1,
			ocOnly: 1,
			ccOnly: 1,
		});
	});

	test("free beats paid", () => {
		const t = tally([row("a", 0, 5), row("b", 5, 0)]);
		expect(t.ocWins).toBe(1);
		expect(t.ccWins).toBe(1);
	});
});
